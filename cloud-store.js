/* Auth + Data API. Permissões são impostas pelo PostgreSQL/RLS, nunca por filtros do cliente. */
(function (root) {
    function create(config, dependencies = {}) {
        const fetcher = dependencies.fetch || root.fetch.bind(root);
        const storage = dependencies.storage || root.localStorage;
        const now = dependencies.now || Date.now;
        const locks = dependencies.locks || root.navigator?.locks;
        const base = String(config.url || '').replace(/\/$/, '');
        if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)) throw new Error('URL do Supabase inválida.');
        const key = String(config.publishableKey || '');
        if (!key || key.startsWith('sb_secret_')) throw new Error('Use apenas a chave pública do Supabase.');
        if (key.startsWith('eyJ')) {
            try { if (JSON.parse(atob(key.split('.')[1])).role !== 'anon') throw new Error(); }
            catch { throw new Error('A chave deve ser publishable ou anon. Nunca use service_role.'); }
        }
        const sessionKey = 'droptech_auth_' + new URL(base).hostname;
        let session = null, profile = null, refreshTask = null, generation = 0;
        const readSession = () => { try { return JSON.parse(storage.getItem(sessionKey)); } catch { return null; } };
        function remember(data) {
            session = {...data, expires_at: data.expires_at || Math.floor(now()/1000) + data.expires_in};
            storage.setItem(sessionKey, JSON.stringify(session));
        }
        function clear() {
            ++generation; session = profile = null; storage.removeItem(sessionKey);
        }
        async function request(endpoint, {method='GET', body, token, headers={}} = {}) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), endpoint.startsWith('/functions/') ? 120000 : 30000);
            try {
                const response = await fetcher(base+endpoint, {method, signal:controller.signal,
                    headers: {apikey:key, ...(token ? {Authorization:'Bearer '+token} : {}),
                        ...(body !== undefined ? {'Content-Type':'application/json'} : {}), ...headers},
                    ...(body !== undefined ? {body:JSON.stringify(body)} : {})});
                const text = await response.text();
                let data; try { data = text ? JSON.parse(text) : null; } catch { throw new Error('Resposta inválida do servidor.'); }
                if (!response.ok) {
                    const error = new Error(data?.message || data?.error_description || data?.msg || data?.error || 'Falha ao acessar o servidor.');
                    error.status = response.status;
                    throw error;
                }
                return data;
            } catch (error) {
                if (error.name === 'AbortError') throw new Error('O servidor demorou para responder. Confira a conexão e tente novamente.');
                throw error;
            } finally { clearTimeout(timeout); }
        }
        async function accessToken() {
            if (!session) throw new Error('Entre na sua conta para continuar.');
            if (session.expires_at * 1000 > now()+60000) return session.access_token;
            if (!refreshTask) {
                const refresh = async () => {
                    const version = generation;
                    // Another tab may have rotated the refresh token while this tab waited for the lock.
                    const saved = readSession();
                    if (!saved) { clear(); throw new Error('Sua sessão foi encerrada. Entre novamente.'); }
                    session = saved;
                    if (session.expires_at*1000 > now()+60000) return session.access_token;
                    try {
                        const data = await request('/auth/v1/token?grant_type=refresh_token', {method:'POST',body:{refresh_token:session.refresh_token}});
                        if (version !== generation) throw new Error('Sua sessão foi encerrada.');
                        remember(data); return session.access_token;
                    } catch (error) { if (error.status===400 || error.status===401) clear(); throw error; }
                };
                refreshTask = (locks ? locks.request(sessionKey, refresh) : refresh()).finally(()=>refreshTask=null);
            }
            return refreshTask;
        }
        async function api(endpoint, options={}) {
            const version = generation;
            const token = await accessToken();
            try {
                const result = await request(endpoint,{...options,token});
                if(version !== generation) throw new Error('A sessão foi alterada. Atualize os pedidos antes de continuar.');
                return result;
            }
            catch(error) {if(error.status===401) clear(); throw error;}
        }
        async function loadProfile() {
            const user = await api('/auth/v1/user');
            const rows = await api('/rest/v1/profiles?id=eq.'+encodeURIComponent(user.id)+'&select=id,full_name,email,role,active');
            if (rows.length !== 1 || !rows[0].active) {clear(); throw new Error('Acesso não liberado. Peça ao administrador para ativar sua conta.');}
            profile = rows[0]; return profile;
        }
        async function signIn(email,password) {
            const data = await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
            ++generation; remember(data); return loadProfile();
        }
        async function restore() {
            const saved = readSession();
            if(session?.access_token !== saved?.access_token) {++generation;profile=null;}
            session = saved; if(!session) return null;
            return loadProfile();
        }
        async function signOut() {
            const token = session?.access_token;
            clear();
            if (token) try { await request('/auth/v1/logout?scope=local',{method:'POST',token}); } catch {}
        }
        async function listOrders() {
            const all = [];
            for (let offset=0;;offset+=500) {
                const rows = await api('/rest/v1/orders?select=id,owner_id,payload,google_state,google_error&order=created_at.asc,id.asc&limit=500&offset='+offset);
                all.push(...rows.map(row=>({...row.payload,id:row.id,ownerId:row.owner_id,googleState:row.google_state,googleError:row.google_error})));
                if(rows.length<500) return all;
            }
        }
        async function saveOrder(order) {
            if(!profile) throw new Error('Sessão indisponível. Entre novamente.');
            // IGNORE conflicts makes a retry after a lost HTTP response idempotent, without changing another order.
            await api('/rest/v1/orders?on_conflict=id',{method:'POST',body:{id:order.id,owner_id:profile.id,payload:order},headers:{Prefer:'resolution=ignore-duplicates'}});
            const saved = await api('/rest/v1/orders?id=eq.'+encodeURIComponent(order.id)+'&select=owner_id,payload');
            if(saved.length!==1 || saved[0].owner_id!==profile.id || JSON.stringify(saved[0].payload)!==JSON.stringify(order)) {
                // JSONB does not retain key order; compare values rather than serialization below.
                if(saved.length!==1 || saved[0].owner_id!==profile.id || !equalPayload(saved[0].payload,order)) throw new Error('Conflito no identificador do pedido. Não foi alterado nenhum pedido existente.');
            }
            return order;
        }
        function equalPayload(a,b) {
            if(a===b) return true;
            if(!a || !b || typeof a!=='object' || typeof b!=='object') return false;
            const ak=Object.keys(a),bk=Object.keys(b);
            return ak.length===bk.length && ak.every(k=>bk.includes(k)&&equalPayload(a[k],b[k]));
        }
        async function deleteOrder(id) { await api('/rest/v1/orders?id=eq.'+encodeURIComponent(id),{method:'DELETE',headers:{Prefer:'return=representation'}}).then(rows=>{if(rows.length!==1) throw new Error('Pedido não encontrado ou sem permissão.');}); }
        async function settings() { return api('/rest/v1/rpc/workspace_settings',{method:'POST',body:{}}); }
        async function saveSettings(data) { return api('/rest/v1/app_settings?id=eq.true',{method:'PATCH',body:data}); }
        async function users() { return api('/rest/v1/profiles?select=id,full_name,email,role,active&order=full_name.asc'); }
        async function action(body) { return api('/functions/v1/droptech-api',{method:'POST',body}); }
        async function importOrders(orders,ownerId) {
            if(profile?.role!=='admin') throw new Error('Somente o administrador pode importar pedidos antigos.');
            for(const order of orders) {
                const existing = await api('/rest/v1/orders?id=eq.'+encodeURIComponent(order.id)+'&select=owner_id,payload');
                if(existing.length && (existing[0].owner_id!==ownerId || !equalPayload(existing[0].payload,order))) throw new Error('O pedido '+order.id+' já existe com dados ou vendedor diferentes. Importação pausada, sem substituir pedidos.');
                await api('/rest/v1/orders?on_conflict=id',{method:'POST',body:{id:order.id,owner_id:ownerId,payload:order},headers:{Prefer:'resolution=ignore-duplicates'}});
            }
        }
        async function recover(email,redirectTo) { await request('/auth/v1/recover?redirect_to='+encodeURIComponent(redirectTo),{method:'POST',body:{email}}); }
        async function recoverySession(hash) {
            const params=new URLSearchParams(hash.replace(/^#/,''));
            if(params.get('type')!=='recovery' || !params.get('access_token') || !params.get('refresh_token')) return false;
            ++generation; remember({access_token:params.get('access_token'),refresh_token:params.get('refresh_token'),expires_in:Number(params.get('expires_in'))||3600});
            await api('/auth/v1/user'); return true;
        }
        async function changePassword(password) { await api('/auth/v1/user',{method:'PUT',body:{password}}); }
        return {signIn,restore,signOut,listOrders,saveOrder,deleteOrder,settings,saveSettings,users,action,importOrders,recover,recoverySession,changePassword,
            currentProfile:()=>profile,hasSession:()=>!!session,clear};
    }
    const exported={create};
    if(typeof module!=='undefined'&&module.exports) module.exports=exported;
    root.CloudStore=exported;
})(typeof globalThis!=='undefined'?globalThis:this);

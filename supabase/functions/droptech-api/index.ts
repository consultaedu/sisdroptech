import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = (Deno.env.get('APP_ORIGINS') || '').split(',').map(s=>s.trim()).filter(Boolean);
const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

Deno.serve(async (request:Request) => {
  const origin=request.headers.get('Origin')||'';
  if (!allowedOrigins.includes(origin)) return new Response('Origem não autorizada',{status:403});
  const headers={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
  const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(request.method==='OPTIONS')return reply({});
  if(request.method!=='POST')return reply({message:'Método inválido'},405);
  try {
    const text=await request.text();
    if(text.length>16000)return reply({message:'Requisição muito grande'},413);
    let body;
    try { body=JSON.parse(text); } catch { return reply({message:'Dados inválidos'},400); }
    if(!body||typeof body!=='object'||Array.isArray(body))return reply({message:'Dados inválidos'},400);
    if(body.action==='login') {
      const invalid=()=>reply({message:'Usuário ou senha inválidos.'},400);
      const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
      if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)||typeof body.password!=='string'||!body.password||body.password.length>200)return invalid();
      const {data:account,error:lookupError}=await admin.from('profiles').select('id,email,active').eq('username',username).maybeSingle();
      if(lookupError)return reply({message:'Login por usuário ainda não configurado. Entre com seu e-mail.'},503);
      if(!account?.active)return invalid();
      const {data:allowed,error:limitError}=await admin.rpc('reserve_username_login',{account_id:account.id});
      if(limitError)return reply({message:'Login por usuário ainda não configurado. Entre com seu e-mail.'},503);
      if(!allowed)return reply({message:'Muitas tentativas. Aguarde um minuto e tente novamente.'},429);
      const authClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data,error}=await authClient.auth.signInWithPassword({email:account.email,password:body.password});
      if(error?.status===429)return reply({message:'Muitas tentativas. Aguarde um minuto e tente novamente.'},429);
      if(error||!data?.session)return invalid();
      // Recheck activation after password verification; never return another account's session.
      const {data:current}=await admin.from('profiles').select('active').eq('id',account.id).single();
      if(!current?.active||data.user?.id!==account.id||data.session.user?.id!==account.id)return invalid();
      return reply({access_token:data.session.access_token,refresh_token:data.session.refresh_token,
        expires_in:data.session.expires_in,token_type:data.session.token_type});
    }
    const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
    const {data:{user},error:authError}=await admin.auth.getUser(token);
    if(authError||!user)return reply({message:'Sessão inválida'},401);
    const {data:profile,error:profileError}=await admin.from('profiles').select('id,role,active').eq('id',user.id).single();
    if(profileError||!profile?.active)return reply({message:'Acesso não liberado'},403);
    if(body.action==='create_seller') {
      if(profile.role!=='admin')return reply({message:'Apenas administradores podem cadastrar vendedores'},403);
      const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
      if(typeof body.email!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)||typeof body.name!=='string'||!body.name.trim()||body.name.length>120||typeof body.password!=='string'||body.password.length<6||body.password.length>200|| (body.username!==undefined&&!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)))return reply({message:'Informe nome, usuário válido, e-mail e senha com pelo menos 6 caracteres'},400);
      if(username){const {data:existing,error:lookupError}=await admin.from('profiles').select('id').eq('username',username).maybeSingle();if(lookupError)return reply({message:'Atualize o banco para cadastrar nomes de usuário.'},503);if(existing)return reply({message:'Esse nome de usuário já está em uso.'},400);}
      const {data,error}=await admin.auth.admin.createUser({email:body.email.trim(),password:body.password,email_confirm:true,user_metadata:{full_name:body.name.trim(),...(username?{username}:{})}});
      if(error)return reply({message:error.message},400);
      const {error:activateError}=await admin.from('profiles').update({active:true}).eq('id',data.user.id).eq('role','seller');
      if(activateError)return reply({message:'Conta criada sem ativação. Confira o cadastro no painel.'},500);
      return reply({message:'Vendedor cadastrado',id:data.user.id});
    }
    if(body.action==='set_username') {
      if(profile.role!=='admin')return reply({message:'Apenas administradores podem definir nomes de usuário'},403);
      const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
      if(typeof body.id!=='string'||!body.id||! /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username))return reply({message:'Use de 3 a 32 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.'},400);
      const {data,error}=await admin.from('profiles').update({username}).eq('id',body.id).select('id,username');
      if(error)return reply({message:error.code==='23505'?'Esse nome de usuário já está em uso.':'Não foi possível alterar o nome de usuário.'},400);
      if(data?.length!==1)return reply({message:'Conta não encontrada'},404);
      return reply({message:'Nome de usuário atualizado',username});
    }
    if(body.action==='set_seller_active') {
      if(profile.role!=='admin')return reply({message:'Apenas administradores podem alterar acesso'},403);
      if(typeof body.active!=='boolean'||typeof body.id!=='string')return reply({message:'Dados inválidos'},400);
      // Administrators cannot disable/promote themselves or another admin through this endpoint.
      const {data,error}=await admin.from('profiles').update({active:body.active}).eq('id',body.id).eq('role','seller').select('id');
      if(error||data?.length!==1)return reply({message:'Vendedor não encontrado'},400);
      return reply({message:body.active?'Acesso ativado':'Acesso desativado'});
    }
    if(body.action==='sync_google') {
      if(!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>100||!body.ids.every((id:unknown)=>typeof id==='string'&&id.length<=100))return reply({message:'Selecione entre 1 e 100 pedidos'},400);
      // Use caller JWT so RLS restricts the records even inside a service function.
      const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
      const ids=[...new Set(body.ids)];
      const {data:orders,error}=await caller.from('orders').select('id,payload').in('id',ids);
      if(error||orders?.length!==ids.length)return reply({message:'Pedido não encontrado ou sem permissão'},403);
      const {data:settings}=await admin.from('app_settings').select('google_script_url').eq('id',true).single();
      const secret=Deno.env.get('GOOGLE_SYNC_TOKEN')||'';
      if(!secret||!settings?.google_script_url)return reply({message:'O administrador ainda não configurou o envio ao Google'},409);
      if(!/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(settings.google_script_url))return reply({message:'Destino Google inválido'},400);
      let result;
      try {
        const response=await fetch(settings.google_script_url,{method:'POST',redirect:'follow',headers:{'Content-Type':'application/json'},body:JSON.stringify({serverToken:secret,payload:{version:1,requestId:crypto.randomUUID(),orders:orders.map(o=>o.payload)}}),signal:AbortSignal.timeout(85000)});
        result=await response.json();
        if(!response.ok||!result.ok||!Array.isArray(result.orderIds)||ids.some(id=>!result.orderIds.includes(id))||!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+\/edit$/.test(result.spreadsheetUrl||''))throw new Error(result.message||'O Google não confirmou todos os pedidos.');
      } catch {
        await admin.from('orders').update({google_state:'error',google_error:'Envio sem confirmação. O pedido está salvo no banco; reenviar não cria duplicata.'}).in('id',ids);
        return reply({message:'O pedido está salvo no banco, mas o Google não confirmou o envio. Tente reenviar.'},502);
      }
      const {error:statusError}=await admin.from('orders').update({google_state:'sent',google_error:''}).in('id',ids);
      await admin.from('app_settings').update({google_sheet_url:result.spreadsheetUrl}).eq('id',true).eq('google_script_url',settings.google_script_url);
      if(statusError)return reply({message:'O Google confirmou o envio, mas o estado no banco não foi atualizado. Um reenvio é seguro.'},502);
      // Full spreadsheet is shared with administrators only, never exposed to sellers.
      return reply({message:ids.length+' pedido(s) confirmado(s) no Google',...(profile.role==='admin'?{spreadsheetUrl:result.spreadsheetUrl}:{})});
    }
    return reply({message:'Ação inválida'},400);
  } catch {return reply({message:'Falha ao executar a operação. Confira a conexão e tente novamente.'},500);}
});

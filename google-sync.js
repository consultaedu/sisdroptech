/* Fila local + aba Google autenticada. Nunca confirma apenas por iniciar o envio. */
(function (root) {
    function create(options) {
        const win = options.window || root.window;
        const storage = options.storage || root.localStorage;
        const schedule = options.setTimeout || root.setTimeout;
        const unschedule = options.clearTimeout || root.clearTimeout;
        const now = options.now || Date.now;
        const storageKey = 'droptech_google_sync_v1';
        let records, destinations, paused;
        try { records = JSON.parse(storage.getItem(storageKey)) || {}; } catch { records = {}; }
        try { destinations = JSON.parse(storage.getItem('droptech_google_destinations_v1')) || {}; } catch { destinations = {}; }
        let active = null, bridge = null, watcher = null, lastMessage = '';
        try { paused = new Set(JSON.parse(storage.getItem('droptech_google_paused_v1')) || []); } catch { paused = new Set(); }
        const validSheet = url => /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+(?:\/edit)?(?:#gid=\d+)?$/.test(url || '');
        const validOrigin = origin => /^https:\/\/(?:script\.google\.com|(?:[a-z0-9.-]*[.-])?script\.googleusercontent\.com)$/.test(origin || '');
        const target = () => options.getUrl();
        const bucket = url => records[url] ||= {};
        const status = (id, url = target()) => records[url]?.[id] || { state: 'not_sent' };
        function notify(message) {
            if (message) lastMessage = message;
            options.onChange?.(lastMessage);
        }
        function save() {
            try {
                storage.setItem(storageKey, JSON.stringify(records));
                storage.setItem('droptech_google_destinations_v1', JSON.stringify(destinations));
                storage.setItem('droptech_google_paused_v1', JSON.stringify([...paused]));
            } catch { notify('Não foi possível salvar o estado de envio. Os pedidos continuam no histórico local.'); return false; }
            return true;
        }
        function isConnected() {
            return !!(bridge && bridge.url === target() && bridge.source && !bridge.popup.closed && now() - bridge.lastSeen < 180000);
        }
        function connectionLabel() {
            if (isConnected()) return paused.has(target()) ? 'conectado • envio pausado' : 'conectado';
            return bridge && bridge.url === target() ? 'aguardando conexão' : 'desconectado';
        }
        function labels(id) {
            const entry = status(id);
            if (entry.state === 'queued') {
                if (win.navigator?.onLine === false) return 'Aguardando internet';
                if (paused.has(target())) return 'Envio pausado — confira a falha';
                if (!isConnected()) return 'Conecte ao Google para enviar';
                if (!options.isAutomatic() && !entry.manual) return 'Envio automático desativado';
                return 'Aguardando envio';
            }
            return { sending: 'Enviando ao Google', sent: 'Confirmado no Google', error: 'Falha no envio',
                unconfirmed: 'Envio sem confirmação — reenviar', not_sent: 'Não enviado neste ambiente' }[entry.state] || 'Não enviado';
        }
        function remember(url, sheetUrl) { if (validSheet(sheetUrl)) destinations[url] = sheetUrl; }
        function finish(message, success) {
            if (!active) return;
            const url = active.url;
            active = null;
            if (!success) paused.add(url);
            save(); notify(message);
            if (success) pump();
        }
        function stopActive(message) {
            if (!active) return;
            active.orders.forEach(order => bucket(active.url)[order.id] = {
                state: 'unconfirmed', updatedAt: new Date(now()).toISOString(), error: message
            });
            finish(message, false);
        }
        function watch() {
            watcher = null;
            check();
            if (bridge || active) watcher = schedule(watch, 3000);
        }
        function ensureWatch() { if (!watcher) watcher = schedule(watch, 3000); }
        function check() {
            if (active && now() >= active.deadline) {
                stopActive('O Google não respondeu dentro de 90 segundos. O pedido continua salvo. Confira a aba Google e clique em Reenviar pendentes para tentar novamente.');
                bridge = null;
                notify();
            }
            if (bridge && (bridge.popup.closed || now() >= (bridge.source ? bridge.lastSeen + 180000 : bridge.deadline))) {
                const message = bridge.source ? 'A conexão com a aba Google foi interrompida. Clique em Conectar ao Google.'
                    : 'O Google não confirmou a conexão. Confira login e autorização na aba aberta. Se ela mostrar a tela antiga de consulta, atualize a implantação do Apps Script e conecte novamente.';
                stopActive(message);
                bridge = null; notify(message);
            }
        }
        function connect() {
            check();
            if (!root.OrderTools.validateGoogleUrl(target())) { notify('Salve primeiro a URL do ambiente em Configurar Google Planilhas.'); return false; }
            if (isConnected()) { notify('Conectado ao Google. Mantenha a aba Google aberta durante o uso.'); pump(); return true; }
            const nonce = root.OrderTools.newId();
            const url = target();
            const popup = win.open(url + '?bridge=2&nonce=' + encodeURIComponent(nonce) + '&origin=' + encodeURIComponent(win.location.origin),
                'droptech_google_' + nonce.replace(/-/g, ''));
            if (!popup) { notify('O navegador bloqueou a aba Google. Permita pop-ups deste sistema e clique em Conectar ao Google.'); return false; }
            bridge = { url, nonce, popup, source: null, origin: '', deadline: now() + 90000, lastSeen: 0 };
            ensureWatch(); notify('Aguardando conexão. Conclua o login na aba Google e mantenha-a aberta. Nenhum envio começa antes da confirmação de acesso.');
            return true;
        }
        function enqueue(orders, manual = false) {
            check();
            const url = target();
            if (!root.OrderTools.validateGoogleUrl(url)) { notify('Pedido salvo localmente. Configure o link do Google para enviar.'); return false; }
            if (!manual && !options.isAutomatic()) { notify('Pedido salvo localmente. O envio automático está desativado.'); return false; }
            let queued = 0;
            orders.forEach(order => {
                if (!['sent', 'sending'].includes(status(order.id, url).state)) {
                    bucket(url)[order.id] = { state: 'queued', manual, updatedAt: new Date(now()).toISOString() }; queued++;
                }
            });
            if (!queued) { notify('Os pedidos escolhidos já estão confirmados ou em envio neste ambiente.'); return true; }
            if (manual) paused.delete(url);
            if (!save()) return false;
            if (!isConnected()) {
                notify('Pedido(s) salvo(s). Clique em Conectar ao Google para enviar automaticamente pela aba autorizada.');
                if (manual) connect();
            } else pump();
            return true;
        }
        function pump() {
            if (active || paused.has(target())) return;
            const url = target();
            const orders = options.getOrders().filter(order => {
                const entry = status(order.id, url);
                return entry.state === 'queued' && (options.isAutomatic() || entry.manual);
            }).slice(0, 20);
            if (!orders.length) return;
            if (win.navigator?.onLine === false) { notify('Sem internet. Os pedidos aguardam conexão e continuam salvos localmente.'); return; }
            if (!isConnected()) { notify('Há pedidos na fila. Clique em Conectar ao Google e mantenha a aba aberta.'); return; }
            const requestId = root.OrderTools.newId();
            active = { url, requestId, orders, deadline: now() + (options.timeoutMs || 90000) };
            orders.forEach(order => bucket(url)[order.id] = { state: 'sending', updatedAt: new Date(now()).toISOString() });
            if (!save()) { stopActive('O envio foi interrompido porque o estado local não pôde ser salvo.'); return; }
            ensureWatch();
            try {
                bridge.source.postMessage({ channel: 'droptech-google-send', nonce: bridge.nonce,
                    payload: { version: 1, requestId, orders } }, bridge.origin);
                notify(`Enviando ${orders.length} pedido(s) ao Google. Aguardando confirmação por até 90 segundos…`);
            } catch (error) { stopActive('Não foi possível comunicar com a aba Google. Conecte novamente.'); bridge = null; notify(); }
        }
        function receive(event) {
            check();
            const data = event.data;
            if (!bridge || !validOrigin(event.origin) || !data || data.nonce !== bridge.nonce || !event.source) return;
            if (bridge.source && (event.source !== bridge.source || event.origin !== bridge.origin)) return;
            if (data.channel === 'droptech-google-bridge' && data.protocol === 2) {
                if (data.type === 'error') { stopActive(String(data.message || 'Falha na conexão Google.')); bridge = null; notify(String(data.message || 'Falha na conexão Google.')); return; }
                if (data.type !== 'ready') return;
                const first = !bridge.source;
                bridge.source = event.source; bridge.origin = event.origin; bridge.lastSeen = now();
                try { bridge.source.postMessage({ channel: 'droptech-google-connected', nonce: bridge.nonce }, bridge.origin); }
                catch (error) { bridge = null; stopActive('O navegador interrompeu a comunicação com o Google. Conecte novamente.'); notify('Não foi possível confirmar a conexão. Conecte novamente.'); return; }
                remember(bridge.url, data.spreadsheetUrl);
                if (first) { save(); notify('Conectado ao Google. Mantenha a aba aberta; os novos pedidos serão enviados ao salvar.'); pump(); }
                return;
            }
            if (!active || !bridge.source || data.channel !== 'droptech-google-sync' || data.requestId !== active.requestId) return;
            const confirmed = new Set(Array.isArray(data.orderIds) ? data.orderIds : []);
            const valid = validSheet(data.spreadsheetUrl);
            const success = data.ok === true && valid && active.orders.every(order => confirmed.has(order.id));
            remember(active.url, data.spreadsheetUrl);
            active.orders.forEach(order => {
                const sent = data.ok === true && valid && confirmed.has(order.id);
                bucket(active.url)[order.id] = { state: sent ? 'sent' : 'error', updatedAt: new Date(now()).toISOString(),
                    spreadsheetUrl: valid ? data.spreadsheetUrl : '', error: sent ? '' : String(data.message || 'Confirmação incompleta do Google.') };
            });
            finish(success ? 'Pedido(s) confirmado(s) na planilha do Google.' : 'Falha no envio: ' + String(data.message || 'Confirmação incompleta do Google.') + ' A fila foi pausada. Confira o erro e use Reenviar pendentes.', success);
        }
        function retryPending() {
            check();
            if (active) { notify('Há um envio em andamento. Aguarde a confirmação ou o prazo de 90 segundos antes de reenviar.'); return; }
            const orders = options.getOrders().filter(order => ['queued', 'error', 'unconfirmed'].includes(status(order.id).state));
            if (!orders.length) { notify('Não há envios pendentes neste ambiente.'); return; }
            enqueue(orders, true);
        }
        function settingsChanged() {
            if (bridge && bridge.url !== target()) {
                stopActive('Destino alterado durante o envio. Confira o pedido no ambiente anterior antes de reenviar.'); bridge = null;
            }
            notify('Destino atualizado. Clique em Conectar ao Google. A fila de outro ambiente permanece no ambiente de origem.'); pump();
        }
        function start() {
            let interrupted = false;
            Object.values(records).forEach(entries => Object.values(entries).forEach(entry => {
                if (entry.state === 'sending') { entry.state = 'unconfirmed'; entry.error = 'A página foi fechada antes da confirmação. Confira a planilha e use Reenviar pendentes.'; interrupted = true; }
            }));
            save(); win.addEventListener('message', receive);
            win.addEventListener('online', () => { check(); pump(); });
            win.addEventListener('focus', check);
            options.document?.addEventListener?.('visibilitychange', check);
            notify(interrupted ? 'Foi encontrado um envio interrompido. Use Reenviar pendentes para conferir/enviar pela aba Google.'
                : 'Clique em Conectar ao Google para ativar a conexão desta sessão. Mantenha a aba Google aberta.');
        }
        function spreadsheetUrl() {
            const url = destinations[target()] || Object.values(records[target()] || {}).find(entry => entry.spreadsheetUrl)?.spreadsheetUrl;
            return validSheet(url) ? url : '';
        }
        function destroy() { if (watcher) unschedule(watcher); bridge = null; }
        return { start, connect, enqueue, retryPending, settingsChanged, status, labels, spreadsheetUrl, receive, check,
            connectionLabel, isConnected, destroy, openInWindow: orders => enqueue(orders, true) };
    }
    root.GoogleSync = { create };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.GoogleSync;
})(typeof globalThis !== 'undefined' ? globalThis : window);

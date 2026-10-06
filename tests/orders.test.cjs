const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tools = require('../order-tools.js');
const sync = require('../google-sync.js');
const orderPdf = require('../order-pdf.js');
const pdfLibrary = require('../vendor/pdf-lib-1.17.1.min.js');
const root = path.resolve(__dirname, '..');

function order(overrides = {}) {
    return { id: 'test-order-1', date: '05/10/2026 14:30', client: 'Comércio São José', cnpj: '01.234.567/0001-00',
        ie: 'Isento', buyer: 'Maria', phone: '(27) 99999-9999', payment: 'Boleto Bancário em 3x',
        items: [{ product: 'Mangueira cristal', detail: '2 rolos de 50m', meters: 100, unitPrice: 2.125, subtotal: 212.5 }],
        gross: 212.5, discountPct: 10, discountVal: 21.25, final: 191.25, ...overrides };
}

test('Busca ignora acentos e encontra cliente, CNPJ, produto e identificação', () => {
    const data = order();
    assert.ok(tools.matches(data, 'sao jose'));
    assert.ok(tools.matches(data, '01.234'));
    assert.ok(tools.matches(data, 'cristal'));
    assert.ok(tools.matches(data, 'DT-TESTORDER1'));
    assert.equal(tools.matches(data, 'outro cliente'), false);
});

test('PDF contém um único pedido, valores e texto escapado', () => {
    const html = tools.printHtml(order({ client: '<img src=x onerror=alert(1)>' }));
    assert.ok(html.includes('&lt;img'));
    assert.equal(html.includes('<img'), false);
    assert.ok(html.includes('191,25'));
    assert.ok(html.includes('2,1250'));
    assert.ok(html.includes('Boleto Bancário em 3x'));
    assert.ok(html.includes('21,25'));
});

test('CSV preserva aspas, quebras de linha e protege fórmulas em campos de texto', () => {
    const csv = tools.csv([order({ client: '=IMPORTXML("https://example.com")', buyer: 'Maria; "Compras"\nFilial' })]);
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes('"\'=IMPORTXML(""https://example.com"")"'));
    assert.ok(csv.includes('"Maria; ""Compras""\nFilial"'));
    assert.ok(csv.includes('191.25'));
});

test('Somente URL de implantação Google HTTPS é aceita', () => {
    assert.ok(tools.validateGoogleUrl('https://script.google.com/macros/s/abc-123_/exec'));
    for (const url of ['http://script.google.com/macros/s/abc/exec', 'https://example.com/macros/s/abc/exec',
        'https://script.google.com.evil.test/macros/s/abc/exec', 'https://script.google.com/macros/s/abc/dev',
        'https://user@script.google.com/macros/s/abc/exec', 'https://script.google.com/macros/s/abc/exec?x=1'])
        assert.equal(tools.validateGoogleUrl(url), false, url);
});

const googleContext = require('./google-mock.cjs');

test('Exportação Google cria consulta e guias separadas para o mesmo cliente', () => {
    const mock = googleContext();
    const orders = [order(), order({ id: 'test-order-2', client: '=Cliente / [] ? * : teste' })];
    const output = mock.context.doPost({ parameter: { payload: JSON.stringify({ version: 1, orders }) } });
    assert.ok(output.html.includes('Pedidos confirmados no Google'), output.html);
    assert.equal(mock.sheets.length, 4);
    assert.equal(mock.sheets[0].name, 'Consulta de pedidos');
    assert.equal(new Set(mock.sheets.map(sheet => sheet.name)).size, 4);
    assert.ok(mock.sheets.slice(2).every(sheet => !/[\\/?*\[\]:]/.test(sheet.name)));
    const summary = mock.calls.find(call => call.sheet === 'Consulta de pedidos' && call.method === 'setValues' && call.address[0] === 7);
    assert.equal(summary.args[0][0][4], '01.234.567/0001-00');
    assert.equal(summary.args[0][0][8], 191.25);
    assert.equal(typeof summary.args[0][0][8], 'number');
    assert.equal(summary.args[0][0][2].toISOString(), '2026-10-05T17:30:00.000Z');
    assert.ok(summary.args[0][1][3].startsWith("'="));
    assert.ok(mock.calls.some(call => call.method === 'createFilter'));
    assert.ok(mock.calls.some(call => call.method === 'insertCheckboxes'));
    const links = mock.calls.find(call => call.method === 'setRichTextValues').args[0];
    assert.equal(links[0][0].url, 'https://docs.google.com/spreadsheets/d/test/edit#gid=2');
    assert.equal(links[1][0].url, 'https://docs.google.com/spreadsheets/d/test/edit#gid=3');
    assert.ok(mock.calls.some(call => call.method === 'setFormula' && call.args[0] === '=COUNTIF(A7:A8;TRUE)'));
    assert.ok(mock.calls.some(call => call.method === 'setFormula' && call.args[0] === '=SUMIF(A7:A8;TRUE;I7:I8)'));
    assert.equal(mock.sheets[0].frozenRows, 6);
    assert.equal(mock.sheets[0].frozenColumns, 0);
});

test('Simulador reproduz o conflito entre mesclagens e congelamento parcial', () => {
    const mock = googleContext();
    const sheet = mock.spreadsheet.insertSheet('Teste');
    sheet.getRange('A1:K1').merge();
    assert.throws(() => sheet.setFrozenColumns(2), /célula mesclada/);
    assert.doesNotThrow(() => sheet.setFrozenColumns(0));
    assert.doesNotThrow(() => sheet.setFrozenRows(6));
});

test('Simulador reproduz erro de análise com vírgula na localidade brasileira', () => {
    const mock = googleContext();
    mock.spreadsheet.setSpreadsheetLocale('pt_BR');
    const sheet = mock.spreadsheet.insertSheet('Teste');
    assert.throws(() => sheet.getRange('H3').setFormula('=COUNTIF(A7:A8,TRUE)'), /análise de fórmula/);
    assert.throws(() => sheet.getRange('K3').setFormula('=SUMIF(A7:A8,TRUE,I7:I8)'), /análise de fórmula/);
    assert.doesNotThrow(() => sheet.getRange('H3').setFormula('=COUNTIF(A7:A8;TRUE)'));
    assert.doesNotThrow(() => sheet.getRange('K3').setFormula('=SUMIF(A7:A8;TRUE;I7:I8)'));
});

test('Dados inválidos ou totais divergentes são rejeitados antes de criar uma planilha', () => {
    for (const orders of [[order({ final: 0 })], [order(), order()], [], [order({ discountPct: 120 })],
        [order({ date: 'inválida' })], Array.from({ length: 101 }, (_, i) => order({ id: 'id-' + i }))]) {
        const mock = googleContext();
        const output = mock.context.doPost({ parameter: { payload: JSON.stringify({ version: 1, orders }) } });
        assert.ok(output.html.includes('não foi concluída'));
        assert.equal(mock.created, 0);
    }
});

test('Falha do serviço Google informa erro e link da planilha parcial', () => {
    const mock = googleContext();
    mock.fail = call => call.sheet.startsWith('001 -') && call.method === 'setValues' && call.address[0] === 13;
    const output = mock.context.doPost({ parameter: { payload: JSON.stringify({ version: 1, orders: [order()] }) } });
    assert.ok(output.html.includes('Falha simulada'));
    assert.ok(output.html.includes('planilha parcial'));
    assert.ok(output.html.includes('https://docs.google.com/spreadsheets/d/test/edit'));
});

test('JavaScript inline do sistema tem sintaxe válida', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    new vm.Script(scripts[0][1]);
});

function appContext(storedOrders, settings = {}) {
    const elements = new Map();
    const storage = new Map([['droptech_sales_v3', JSON.stringify(storedOrders)], ...Object.entries(settings)]);
    const submissions = [];
    const alerts = [];
    const timers = new Map();
    const events = {};
    const opened = [];
    const downloads = [];
    let timerId = 0, currentTime = Date.now();
    class ClockDate extends Date { static now() { return currentTime; } }
    function element() {
        const node = { value: '', children: [], listeners: {}, textContent: '', open: false,
            classList: { add() {}, remove() {} }, addEventListener(type, fn) { this.listeners[type] = fn; },
            appendChild(child) { this.children.push(child); }, remove() {}, focus() {}, click() { downloads.push(this); },
            showModal() { this.open = true; }, close() { this.open = false; }, reset() {},
            querySelector() { return this.checkbox ||= element(); },
            submit() { submissions.push(this.children[0].value); } };
        Object.defineProperty(node, 'innerHTML', { set(value) { this.html = value; this.children = []; }, get() { return this.html; } });
        return node;
    }
    const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
        createElement: element, body: element(), title: 'DropTech' };
    const window = { print() {}, location: { origin: 'http://localhost:4173' }, navigator: { onLine: true },
        open(url, name, features) { const popup = { closed: false }; opened.push({ url, name, features, popup }); return popup; },
        addEventListener(type, listener) { events[type] = listener; } };
    const context = vm.createContext({ document, window, OrderTools: tools,
        OrderPdf: { ...orderPdf, build: data => orderPdf.build(data, pdfLibrary) }, GoogleSync: sync, localStorage: {
        getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value)
    }, alert: message => alerts.push(message), confirm: () => true, URL, Blob,
        Date: ClockDate,
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) });
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1], context);
    return { context, elements, storage, submissions, alerts, document, window, timers, events, opened, downloads,
        advance(ms) { currentTime += ms; vm.runInContext('googleSync.check()', context); } };
}

test('Histórico antigo é preservado e recebe IDs estáveis sem colidir', () => {
    const legacy = order();
    delete legacy.id;
    const app = appContext([legacy, order(), order({ id: 'test-order-1' })]);
    const saved = JSON.parse(app.storage.get('droptech_sales_v3'));
    assert.equal(saved.length, 3);
    assert.equal(saved[0].final, legacy.final);
    assert.equal(new Set(saved.map(item => item.id)).size, 3);
    const reopened = appContext(saved);
    assert.deepEqual(JSON.parse(reopened.storage.get('droptech_sales_v3')).map(item => item.id), saved.map(item => item.id));
});

test('Seleção funciona com busca, preserva pedidos ocultos e envia somente o escolhido', () => {
    const app = appContext([order(), order({ id: 'second', client: 'Outro cliente' })]);
    app.elements.get('orderSearch').value = 'sao jose';
    app.context.selectVisibleOrders(true);
    assert.equal(app.elements.get('selectionCount').textContent, '1 pedido(s) selecionado(s)');
    app.elements.get('orderSearch').value = 'Outro';
    app.context.renderSalesHistory();
    assert.equal(app.elements.get('selectVisibleOrders').checked, false);
    assert.equal(vm.runInContext('exportOrders()[0].client', app.context), 'Comércio São José');
    app.context.exportToGoogleSheets();
    assert.equal(app.submissions.length, 0);
    assert.equal(app.elements.get('googleSettings').open, true);
    app.storage.set('droptech_google_script_url', 'https://script.google.com/macros/s/test/exec');
    app.context.exportToGoogleSheets();
    connectGoogle(app);
    const payload = JSON.parse(app.submissions[0]);
    assert.equal(payload.orders.length, 1);
    assert.equal(payload.orders[0].id, 'test-order-1');
    app.context.clearOrderSelection();
    assert.equal(vm.runInContext('exportOrders().length', app.context), 2);
});

test('PDF e exclusão usam o pedido correto quando o histórico está filtrado', () => {
    const app = appContext([order(), order({ id: 'second', client: 'Outro cliente' })]);
    app.elements.get('orderSearch').value = 'Outro';
    app.context.renderSalesHistory();
    app.context.previewSale(1);
    assert.ok(app.elements.get('printOrder').innerHTML.includes('Outro cliente'));
    assert.equal(app.elements.get('printOrder').innerHTML.includes('Comércio São José'), false);
    app.context.closeOrderPreview();
    assert.equal(app.elements.get('orderPreview').open, false);
    app.context.deleteSale(1);
    assert.equal(JSON.parse(app.storage.get('droptech_sales_v3'))[0].id, 'test-order-1');
});

function sendToServer(mock, orders, extra = {}) {
    return mock.context.doPost({ parameter: { payload: JSON.stringify({ version: 1, orders, ...extra }) } });
}

test('Servidor usa uma única planilha, não duplica reenvios e mantém consulta cumulativa', () => {
    const mock = googleContext();
    assert.ok(sendToServer(mock, [order()]).html.includes('Pedidos confirmados'));
    assert.ok(sendToServer(mock, [order(), order({ id: 'second' })]).html.includes('Pedidos confirmados'));
    assert.ok(sendToServer(mock, [order()]).html.includes('Pedidos confirmados'));
    assert.equal(mock.created, 1);
    assert.equal(mock.sheets.length, 4); // Consulta, controle e dois pedidos.
    assert.equal(mock.properties.get('DROPTECH_SPREADSHEET_ID'), 'test');
    const summary = mock.spreadsheet.getSheetByName('Consulta de pedidos');
    assert.equal(summary.getCell(3, 2), 2);
    assert.equal(summary.getCell(7, 2), 'DT-TESTORDER1');
    assert.equal(summary.getCell(8, 2), 'DT-SECOND');
    assert.deepEqual(mock.lockEvents, ['acquired', 'released', 'acquired', 'released', 'acquired', 'released']);
    assert.ok(mock.calls.filter(call => call.method === 'setValues').every(call => call.lockHeld));
});

test('Consulta preserva seleção e critérios de filtro ao acrescentar pedidos', () => {
    const mock = googleContext();
    sendToServer(mock, [order()]);
    const summary = mock.spreadsheet.getSheetByName('Consulta de pedidos');
    summary.getRange('A7').setValue(true);
    const criteria = { search: 'São José' };
    summary.getFilter().setColumnFilterCriteria(4, criteria);
    assert.ok(sendToServer(mock, [order({ id: 'second' })]).html.includes('Pedidos confirmados'));
    assert.equal(summary.getCell(7, 1), true);
    assert.equal(summary.getCell(8, 1), false);
    assert.equal(summary.getFilter().getColumnFilterCriteria(4), criteria);
});

test('Reconstrução da consulta preserva texto especial e zeros de identificadores', () => {
    const mock = googleContext();
    sendToServer(mock, [order({ client: '=Cliente "especial"', cnpj: '00000000000000' })]);
    sendToServer(mock, [order({ id: 'second' })]);
    const summary = mock.spreadsheet.getSheetByName('Consulta de pedidos');
    assert.equal(summary.getCell(7, 4), '\'=Cliente "especial"');
    assert.equal(summary.getCell(7, 5), '00000000000000');
});

test('Retry reaproveita guia parcial em vez de duplicá-la', () => {
    const mock = googleContext();
    mock.fail = call => call.sheet.startsWith('001 -') && call.method === 'setValues' && call.address[0] === 13;
    assert.ok(sendToServer(mock, [order()]).html.includes('não foi concluída'));
    const sheetCount = mock.sheets.length;
    const registry = mock.spreadsheet.getSheetByName('_DropTech controle');
    assert.equal(registry.getCell(2, 11), 'writing');
    mock.fail = null;
    assert.ok(sendToServer(mock, [order()]).html.includes('Pedidos confirmados'));
    assert.equal(mock.created, 1);
    assert.equal(mock.sheets.length, sheetCount);
    assert.equal(registry.getCell(2, 11), 'complete');
});

test('Perda de acesso à planilha não cria silenciosamente outra planilha', () => {
    const mock = googleContext();
    mock.properties.set('DROPTECH_SPREADSHEET_ID', 'missing');
    assert.ok(sendToServer(mock, [order()]).html.includes('Planilha sem acesso'));
    assert.equal(mock.created, 0);
    assert.deepEqual(mock.lockEvents, ['acquired', 'released']);
});

test('Servidor inclui confirmação autenticada pelo identificador de requisição e escapa scripts', () => {
    const mock = googleContext();
    const output = sendToServer(mock, [order()], { requestId: 'request-123', callbackOrigin: 'http://localhost:4173' });
    assert.ok(output.html.includes('var destination=window.top;'));
    assert.ok(output.html.includes('destination.postMessage('));
    assert.ok(output.html.includes('"requestId":"request-123"'));
    assert.ok(output.html.includes('"ok":true'));
    assert.ok(output.html.includes('"orderIds":["test-order-1"]'));
    assert.ok(output.html.includes('"http://localhost:4173"'));
    const escaped = mock.context.resultPage_('Título', 'Texto', '', { requestId: 'request-1', message: '</script><img>' }, 'null');
    assert.ok(escaped.html.includes('\\u003c/script>'));
    assert.equal(escaped.html.includes('</script><img>'), false);
    assert.equal(output.mode, 'ALLOWALL');
});

const testUrl = 'https://script.google.com/macros/s/test/exec';
const productionUrl = 'https://script.google.com/macros/s/droptech/exec';
function connectGoogle(app, ready = true) {
    if (!app.opened.length) app.context.authorizeGoogle();
    const opened = app.opened.at(-1);
    app.nonce = new URL(opened.url).searchParams.get('nonce');
    app.source = { postMessage(data, origin) {
        assert.equal(origin, 'https://n-example-script.googleusercontent.com');
        assert.equal(data.nonce, app.nonce);
        if (data.channel === 'droptech-google-connected') return;
        assert.equal(data.channel, 'droptech-google-send');
        app.submissions.push(JSON.stringify(data.payload));
    } };
    if (ready) app.events.message({ origin: 'https://n-example-script.googleusercontent.com', source: app.source,
        data: { channel: 'droptech-google-bridge', type: 'ready', protocol: 2, nonce: app.nonce } });
}
function acknowledge(app, payload, overrides = {}, origin = 'https://n-example-script.googleusercontent.com') {
    app.events.message({ origin, source: app.source, data: { nonce: app.nonce, channel: 'droptech-google-sync', requestId: payload.requestId, ok: true,
        orderIds: payload.orders.map(item => item.id), spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit', ...overrides } });
}

test('Salvar novo pedido envia automaticamente, sem exportar os pedidos antigos', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    assert.equal(app.submissions.length, 0);
    connectGoogle(app);
    for (const [id, value] of Object.entries({ clientName: 'Novo cliente', clientCnpj: '00.000.000/0001-00',
        buyerName: 'Comprador', buyerPhone: '(00) 00000-0000', paymentMethod: 'Pix à Vista', discountPercent: '0', installmentsCount: '1' }))
        app.document.getElementById(id).value = value;
    vm.runInContext('currentCart = [{product:"Mangueira",detail:"50m",meters:50,unitPrice:2,subtotal:100}]', app.context);
    app.elements.get('orderForm').listeners.submit({ preventDefault() {} });
    assert.equal(JSON.parse(app.storage.get('droptech_sales_v3')).length, 2);
    assert.equal(app.submissions.length, 1);
    const payload = JSON.parse(app.submissions[0]);
    assert.equal(payload.orders.length, 1);
    assert.equal(payload.orders[0].client, 'Novo cliente');
    assert.notEqual(payload.orders[0].id, 'test-order-1');
    assert.equal(vm.runInContext(`googleSync.status('${payload.orders[0].id}').state`, app.context), 'sending');
    acknowledge(app, payload);
    assert.equal(vm.runInContext(`googleSync.status('${payload.orders[0].id}').state`, app.context), 'sent');
    assert.equal(app.elements.get('googleSpreadsheetLink').hidden, false);
});

test('Confirmação falsa, origem falsa e URL externa não marcam pedidos como enviados', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    app.context.exportToGoogleSheets();
    connectGoogle(app);
    const payload = JSON.parse(app.submissions[0]);
    acknowledge(app, payload, {}, 'https://evil.test');
    acknowledge(app, payload, { requestId: 'wrong-request' });
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'sending');
    acknowledge(app, payload, { spreadsheetUrl: 'https://evil.test/orders' });
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'error');
    assert.equal(app.elements.get('googleSpreadsheetLink').textContent, 'Localizar planilha no Google');
    assert.equal(app.elements.get('googleSpreadsheetLink').href, testUrl);
});

test('Sem conexão mantém fila local e retoma o envio ao voltar a internet', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    app.window.navigator.onLine = false;
    app.context.exportToGoogleSheets();
    assert.equal(app.submissions.length, 0);
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'queued');
    connectGoogle(app);
    assert.equal(app.submissions.length, 0);
    app.window.navigator.onLine = true;
    app.events.online();
    assert.equal(app.submissions.length, 1);
    acknowledge(app, JSON.parse(app.submissions[0]));
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'sent');
});

test('Timeout preserva pedido e permite reenvio com nova identificação de requisição', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    app.context.exportToGoogleSheets();
    connectGoogle(app);
    const first = JSON.parse(app.submissions[0]);
    app.advance(90001);
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'unconfirmed');
    assert.equal(JSON.parse(app.storage.get('droptech_sales_v3')).length, 1);
    vm.runInContext('googleSync.retryPending()', app.context);
    connectGoogle(app);
    const second = JSON.parse(app.submissions[1]);
    assert.notEqual(first.requestId, second.requestId);
    acknowledge(app, first);
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'sending');
    acknowledge(app, second);
    app.context.exportToGoogleSheets();
    assert.equal(app.submissions.length, 2);
});

test('Trocar URL não transfere fila de teste nem confirmação em trânsito para produção', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    app.context.exportToGoogleSheets();
    connectGoogle(app);
    const first = JSON.parse(app.submissions[0]);
    app.elements.get('googleScriptUrl').value = productionUrl;
    app.elements.get('googleEnvironment').value = 'DropTech';
    app.elements.get('googleAutoSend').checked = true;
    app.context.saveGoogleSettings();
    assert.equal(app.submissions.length, 1);
    acknowledge(app, first);
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'not_sent');
    assert.equal(app.elements.get('googleSpreadsheetLink').textContent, 'Localizar planilha no Google');
    assert.equal(app.elements.get('googleSpreadsheetLink').href, productionUrl);
    vm.runInContext('googleSync.retryPending()', app.context);
    assert.equal(app.submissions.length, 1);
    const saved = JSON.parse(app.storage.get('droptech_google_sync_v1'));
    assert.equal(saved[testUrl]['test-order-1'].state, 'unconfirmed');
    assert.equal(saved[productionUrl], undefined);
});

test('Reabrir a página recupera envio interrompido sem reiniciar tentativas ocultas', () => {
    const pending = JSON.stringify({ [testUrl]: { 'test-order-1': { state: 'sending' } } });
    const production = appContext([order()], { droptech_google_script_url: productionUrl, droptech_google_sync_v1: pending });
    assert.equal(production.submissions.length, 0);
    const reopened = appContext([order()], { droptech_google_script_url: testUrl, droptech_google_sync_v1: pending });
    assert.equal(reopened.submissions.length, 0);
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', reopened.context), 'unconfirmed');
    connectGoogle(reopened);
    assert.equal(reopened.submissions.length, 0);
    vm.runInContext('googleSync.retryPending()', reopened.context);
    assert.equal(reopened.submissions.length, 1);
    acknowledge(reopened, JSON.parse(reopened.submissions[0]));
});

test('Envio manual processa lotes completos mesmo com envio automático desativado', () => {
    const orders = Array.from({ length: 25 }, (_, i) => order({ id: 'order-' + i }));
    const app = appContext(orders, { droptech_google_script_url: testUrl, droptech_google_auto_send: 'false' });
    vm.runInContext('googleSync.enqueue([sales[0]])', app.context);
    assert.equal(app.submissions.length, 0);
    app.context.exportToGoogleSheets();
    connectGoogle(app);
    const first = JSON.parse(app.submissions[0]);
    assert.equal(first.orders.length, 20);
    acknowledge(app, first);
    assert.equal(app.submissions.length, 2);
    const second = JSON.parse(app.submissions[1]);
    assert.equal(second.orders.length, 5);
    acknowledge(app, second);
    assert.equal(vm.runInContext('sales.every(order => googleSync.status(order.id).state === "sent")', app.context), true);
});

test('Consulta do aplicativo mostra o destino mesmo sem confirmação no navegador', () => {
    const mock = googleContext();
    sendToServer(mock, [order()]);
    const output = mock.context.doGet();
    assert.ok(output.html.includes('Planilha deste ambiente'));
    assert.ok(output.html.includes('https://docs.google.com/spreadsheets/d/test/edit'));
    assert.equal(mock.created, 1);
});

test('Consulta explica ausência da planilha e erros de acesso sem criar outro destino', () => {
    const mock = googleContext();
    assert.ok(mock.context.doGet().html.includes('Ainda não há uma planilha'));
    mock.properties.set('DROPTECH_SPREADSHEET_ID', 'missing');
    assert.ok(mock.context.doGet().html.includes('Não foi possível localizar'));
    assert.equal(mock.created, 0);
});

test('A conexão autenticada é reutilizada para envios sem novos pop-ups', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    app.context.exportToGoogleSheets();
    assert.equal(app.submissions.length, 0);
    connectGoogle(app);
    const payload = JSON.parse(app.submissions[0]);
    app.context.openGoogleSend();
    assert.equal(app.submissions.length, 1);
    app.context.authorizeGoogle();
    assert.equal(app.opened.length, 1);
    acknowledge(app, payload);
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'sent');
});

test('Aba bloqueada não inicia novo envio nem altera confirmação do pedido', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    app.window.open = () => null;
    app.context.openGoogleSend();
    assert.equal(app.submissions.length, 0);
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'queued');
    assert.equal(vm.runInContext('googleSync.labels("test-order-1")', app.context), 'Conecte ao Google para enviar');
    assert.ok(app.elements.get('exportStatus').textContent.includes('bloqueou'));
});

test('Resposta de envio em aba encaminha confirmação para a janela que abriu o envio', () => {
    const mock = googleContext();
    const output = sendToServer(mock, [order()], { requestId: 'popup-request', callbackOrigin: 'http://localhost:4173', callbackMode: 'popup' });
    assert.ok(output.html.includes('var destination=window.top.opener;'));
    assert.ok(output.html.includes('Abrir planilha'));
    assert.ok(output.html.includes('"ok":true'));
});


function bootRelay(app, server = googleContext()) {
    if (!app.opened.length) app.context.authorizeGoogle();
    const query = new URL(app.opened.at(-1).url).searchParams;
    const parameters = Object.fromEntries(query);
    const html = server.context.doGet({ parameter: parameters }).html;
    assert.ok(html.includes('DropTech — conexão com o Google'));
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
    const listeners = {}, nodes = new Map(), jobs = [], heartbeats = [];
    const origin = 'https://n-example-script.googleusercontent.com';
    const clone = data => JSON.parse(JSON.stringify(data));
    const opener = { closed: false, postMessage(data, targetOrigin) {
        assert.equal(targetOrigin, app.window.location.origin === 'null' ? '*' : app.window.location.origin);
        app.events.message({ origin, source: relayWindow, data: clone(data) });
    } };
    const relayWindow = { top: { opener }, addEventListener(type, fn) { listeners[type] = fn; },
        postMessage(data, targetOrigin) {
            assert.equal(targetOrigin, origin);
            if (data.channel === 'droptech-google-send') app.submissions.push(JSON.stringify(data.payload));
            listeners.message({ origin: app.window.location.origin, source: opener, data: clone(data) });
        } };
    function runner(success, failure) {
        return { withSuccessHandler(fn) { return runner(fn, failure); }, withFailureHandler(fn) { return runner(success, fn); },
            getConnectionInfo() { jobs.push(() => { try { success(clone(server.context.getConnectionInfo())); } catch (error) { failure(error); } }); },
            syncOrders(payload) { jobs.push(() => { try { success(clone(server.context.syncOrders(clone(payload)))); } catch (error) { failure(error); } }); } };
    }
    vm.runInNewContext(script, { window: relayWindow, google: { script: { run: runner() } },
        document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { hidden: true }); return nodes.get(id); } },
        setInterval: fn => heartbeats.push(fn) });
    return { server, nodes, jobs, listeners, relayWindow, opener, config: parameters,
        heartbeat() { heartbeats.forEach(fn => fn()); }, flush() { while (jobs.length) jobs.shift()(); } };
}

test('Fluxo completo da aba: autenticar, confirmar conexão, salvar, receber link e reutilizar planilha', () => {
    const app = appContext([order(), order({ id: 'second' })], { droptech_google_script_url: testUrl });
    app.context.exportToGoogleSheets();
    const relay = bootRelay(app);
    assert.equal(app.submissions.length, 0);
    relay.flush();
    assert.equal(vm.runInContext('googleSync.isConnected()', app.context), true);
    assert.equal(vm.runInContext('sales.every(order => googleSync.status(order.id).state === "sent")', app.context), true);
    assert.equal(relay.server.created, 1);
    assert.equal(relay.server.sheets.length, 4);
    assert.equal(relay.nodes.get('sheet').href, 'https://docs.google.com/spreadsheets/d/test/edit');
    assert.ok(relay.nodes.get('state').textContent.includes('confirmado'));
    relay.heartbeat();
    assert.equal(app.submissions.length, 1);
    app.context.exportToGoogleSheets();
    relay.flush();
    assert.equal(app.submissions.length, 1);
    assert.equal(app.opened.length, 1);
});

test('Arquivo local com origem null conecta sem dispensar validação de janela e nonce', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    app.window.location.origin = 'null';
    app.context.exportToGoogleSheets();
    const relay = bootRelay(app);
    relay.flush();
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'sent');
    relay.listeners.message({ origin: 'null', source: {}, data: { channel: 'droptech-google-send', nonce: relay.config.nonce,
        payload: { version: 1, requestId: 'injection', orders: [order({ id: 'injection' })] } } });
    assert.equal(relay.jobs.length, 0);
});

test('Falha de gravação simulada pausa os próximos lotes e a pausa sobrevive ao recarregar', () => {
    const orders = Array.from({ length: 25 }, (_, i) => order({ id: 'batch-' + i }));
    const app = appContext(orders, { droptech_google_script_url: testUrl });
    app.context.exportToGoogleSheets();
    const relay = bootRelay(app);
    relay.server.fail = call => call.sheet.startsWith('001 -') && call.method === 'setValues' && call.address[0] === 13;
    relay.flush();
    assert.equal(app.submissions.length, 1);
    assert.equal(vm.runInContext('googleSync.status("batch-0").state', app.context), 'error');
    assert.equal(vm.runInContext('googleSync.labels("batch-24")', app.context), 'Envio pausado — confira a falha');
    const errorMessage = app.elements.get('exportStatus').textContent;
    relay.heartbeat();
    assert.equal(app.elements.get('exportStatus').textContent, errorMessage);
    assert.equal(app.submissions.length, 1);
    const reopened = appContext(orders, Object.fromEntries(app.storage));
    const next = bootRelay(reopened, relay.server);
    next.flush();
    assert.equal(reopened.submissions.length, 0);
    assert.equal(vm.runInContext('googleSync.labels("batch-24")', reopened.context), 'Envio pausado — confira a falha');
    relay.server.fail = null;
    vm.runInContext('googleSync.retryPending()', reopened.context);
    next.flush();
    assert.equal(reopened.submissions.length, 2);
    assert.equal(vm.runInContext('sales.every(order => googleSync.status(order.id).state === "sent")', reopened.context), true);
    assert.equal(relay.server.created, 1);
    assert.equal(relay.server.sheets.length, 27);
});

test('Implantação antiga ou login sem resposta encerra a espera e não inicia pedidos', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    app.context.exportToGoogleSheets();
    assert.equal(app.submissions.length, 0);
    app.advance(90001);
    assert.equal(vm.runInContext('googleSync.connectionLabel()', app.context), 'desconectado');
    assert.ok(app.elements.get('exportStatus').textContent.includes('atualize a implantação'));
    assert.equal(vm.runInContext('googleSync.labels("test-order-1")', app.context), 'Conecte ao Google para enviar');
});

test('Fechar a aba durante o envio interrompe a tentativa sem descartar o pedido', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    app.context.exportToGoogleSheets();
    connectGoogle(app);
    app.opened.at(-1).popup.closed = true;
    vm.runInContext('googleSync.check()', app.context);
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'unconfirmed');
    assert.equal(vm.runInContext('googleSync.connectionLabel()', app.context), 'desconectado');
    assert.equal(JSON.parse(app.storage.get('droptech_sales_v3')).length, 1);
});

test('Nonce incorreto e outra janela Google não podem confirmar pedidos', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    app.context.exportToGoogleSheets();
    connectGoogle(app);
    const payload = JSON.parse(app.submissions[0]);
    acknowledge(app, payload, { nonce: 'wrong' });
    app.events.message({ origin: 'https://n-example-script.googleusercontent.com', source: {}, data: {
        channel: 'droptech-google-sync', nonce: app.nonce, requestId: payload.requestId, ok: true,
        orderIds: [order().id], spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit' } });
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'sending');
    acknowledge(app, payload);
    assert.equal(vm.runInContext('googleSync.status("test-order-1").state', app.context), 'sent');
});

test('Acesso à planilha existente é conferido antes de ativar o envio', () => {
    const app = appContext([order()], { droptech_google_script_url: testUrl });
    app.context.exportToGoogleSheets();
    const server = googleContext();
    server.properties.set('DROPTECH_SPREADSHEET_ID', 'missing');
    const relay = bootRelay(app, server);
    relay.flush();
    assert.equal(app.submissions.length, 0);
    assert.equal(vm.runInContext('googleSync.isConnected()', app.context), false);
    assert.ok(app.elements.get('exportStatus').textContent.includes('Planilha sem acesso'));
    assert.equal(server.created, 0);
});

test('Página de conexão rejeita origem e nonce inválidos sem criar planilha', () => {
    const server = googleContext();
    for (const parameters of [{ bridge: '2', nonce: '</script>', origin: 'null' },
        { bridge: '2', nonce: 'abc', origin: 'https://example.com/path' }])
        assert.ok(server.context.doGet({ parameter: parameters }).html.includes('Conexão inválida'));
    assert.equal(server.created, 0);
});


test('Salvar PDF baixa um arquivo individual mesmo sem suporte à impressão do navegador', async () => {
    const app = appContext([order(), order({ id: 'second', client: 'Outro cliente' })]);
    app.window.print = () => { throw new Error('Impressão indisponível'); };
    app.context.previewSale(1);
    app.context.printCurrentOrder();
    assert.ok(app.elements.get('pdfStatus').textContent.includes('Use Salvar em PDF'));
    assert.equal(app.document.title, 'DropTech');
    await app.context.saveCurrentOrderPdf();
    assert.equal(app.downloads.length, 1);
    assert.equal(app.downloads[0].download, 'DT-SECOND-Outro-cliente.pdf');
    assert.ok(app.downloads[0].href.startsWith('blob:'));
    assert.equal(app.elements.get('savePdfButton').disabled, false);
    assert.ok(app.elements.get('pdfStatus').textContent.includes('PDF gerado'));
});

test('Falha ao gerar PDF informa o erro e permite tentar novamente', async () => {
    const app = appContext([order()]);
    app.context.previewSale(0);
    vm.runInContext('OrderPdf.build = async () => { throw new Error("Arquivo de PDF ausente"); }', app.context);
    await app.context.saveCurrentOrderPdf();
    assert.equal(app.downloads.length, 0);
    assert.equal(app.elements.get('savePdfButton').disabled, false);
    assert.ok(app.elements.get('pdfStatus').textContent.includes('Arquivo de PDF ausente'));
});

test('PDF A4 abre com dados e metadados do pedido e quebra páginas para muitos itens', async () => {
    const bytes = await orderPdf.build(order(), pdfLibrary);
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
    const document = await pdfLibrary.PDFDocument.load(bytes);
    assert.equal(document.getPageCount(), 1);
    assert.equal(document.getTitle(), 'DT-TESTORDER1 - Comércio São José');
    assert.ok(Math.abs(document.getPage(0).getWidth() - 595.28) < 0.01);
    const items = Array.from({ length: 60 }, (_, i) => ({ ...order().items[0], product: 'Mangueira ' + i + ' - composição detalhada '.repeat(4) }));
    const large = order({ items, gross: 12750, discountVal: 1275, final: 11475 });
    const largeDocument = await pdfLibrary.PDFDocument.load(await orderPdf.build(large, pdfLibrary));
    assert.ok(largeDocument.getPageCount() > 1);
    assert.equal(orderPdf.filename(order({ client: '../Comércio São José: filial / teste' })), 'DT-TESTORDER1-Comercio-Sao-Jose-filial-teste.pdf');
});

test('Gerador funciona no navegador sem carregar a biblioteca por um script separado', async () => {
    const context = vm.createContext({ console, setTimeout, clearTimeout });
    vm.runInContext('window = this; self = this;', context);
    vm.runInContext(fs.readFileSync(path.join(root, 'order-tools.js'), 'utf8'), context);
    assert.equal(context.PDFLib, undefined);
    vm.runInContext(fs.readFileSync(path.join(root, 'order-pdf.js'), 'utf8'), context);
    assert.equal(typeof context.PDFLib.PDFDocument.create, 'function');
    context.sampleOrder = order();
    const bytes = await vm.runInContext('OrderPdf.build(sampleOrder)', context);
    const pdf = await pdfLibrary.PDFDocument.load(Buffer.from(bytes));
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getTitle(), 'DT-TESTORDER1 - Comércio São José');
});

test('Biblioteca incorporada não perde o global PDFLib quando há AMD ou CommonJS na página', async () => {
    const context = vm.createContext({ console, setTimeout, clearTimeout,
        exports: {}, module: { exports: {} }, define() { throw new Error('O carregador AMD não deve capturar a biblioteca'); } });
    context.define.amd = true;
    vm.runInContext('window = this; self = this;', context);
    vm.runInContext(fs.readFileSync(path.join(root, 'order-tools.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'order-pdf.js'), 'utf8'), context);
    context.sampleOrder = order();
    const bytes = await vm.runInContext('OrderPdf.build(sampleOrder)', context);
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
});

test('Página publicada solicita o gerador completo com versão para renovar o cache', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('src="order-pdf.js?v=2"'));
    assert.equal(html.includes('src="vendor/pdf-lib-1.17.1.min.js"'), false);
    assert.ok(fs.readFileSync(path.join(root, 'order-pdf.js'), 'utf8').includes('root.PDFLib = module.exports;'));
});

test('Logo e favicon usam uma imagem PNG local válida, sem tentativas externas em ciclo', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const logo = html.match(/<img\b[^>]*alt="Logo DropTech Mangueiras"[^>]*>/)[0];
    const logoSrc = logo.match(/src="([^"]+)"/)[1];
    const iconSrc = html.match(/<link\b[^>]*rel="icon"[^>]*href="([^"]+)"/)[1];
    assert.equal(logoSrc, iconSrc);
    assert.ok(!/^https?:/.test(logoSrc));
    assert.equal(logo.includes('onerror='), false);
    assert.equal(html.includes('via.placeholder.com'), false);
    const image = fs.readFileSync(path.join(root, logoSrc.split('?')[0]));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(image.readUInt32BE(16), image.readUInt32BE(20));
});

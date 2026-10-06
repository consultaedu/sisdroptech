/**
 * DropTech: exportação de pedidos para Google Planilhas.
 * Instale este arquivo em um projeto Google Apps Script. Consulte GOOGLE-PLANILHAS.md.
 * Mantém uma planilha por projeto e confirma o envio para a aplicação local.
 */
function doGet(e) {
    if (serverMode_()) return resultPage_('DropTech — integração do servidor', 'Os pedidos são enviados pelo sistema autenticado. A consulta está disponível no painel do administrador.', '');
    if (e && e.parameter && e.parameter.bridge === '2') return connectionPage_(e.parameter);
    try {
        var id = PropertiesService.getScriptProperties().getProperty('DROPTECH_SPREADSHEET_ID');
        if (!id) return resultPage_('Ainda não há uma planilha neste ambiente',
            'O acesso ao aplicativo está disponível, mas nenhum envio criou a planilha contínua. Volte ao sistema e envie um pedido. Para pedidos antigos, selecione-os e use “Enviar / conferir selecionados”. Para uma tentativa sem confirmação, use “Reenviar pendentes”.', '');
        var spreadsheet = SpreadsheetApp.openById(id);
        return resultPage_('Planilha deste ambiente',
            'Esta é a planilha contínua vinculada a este aplicativo Google. Clique abaixo para abri-la. Para pedidos que ainda não aparecem, confira o estado de envio no histórico do sistema.', spreadsheet.getUrl());
    } catch (error) {
        return resultPage_('Não foi possível localizar a planilha',
            String(error.message || error) + ' Confira a conta e o acesso à planilha configurada. Nenhuma nova planilha foi criada por esta consulta.', '');
    }
}

function doPost(e) {
    if (serverMode_()) return serverPost_(e);
    var payload;
    try {
        if (!e || !e.parameter || !e.parameter.payload) throw new Error('Nenhum pedido recebido.');
        if (e.parameter.payload.length > 2000000) throw new Error('Envio muito grande. Selecione menos pedidos.');
        payload = JSON.parse(e.parameter.payload);
    } catch (error) {
        return resultPage_('A exportação não foi concluída', String(error.message || error), '');
    }
    var result = syncOrders(payload);
    return resultPage_(result.ok ? 'Pedidos confirmados no Google' : 'A exportação não foi concluída',
        result.message + (!result.ok && result.spreadsheetUrl ? ' Uma planilha parcial foi criada. Confira-a antes de repetir o envio.' : ''),
        result.spreadsheetUrl, result, payload.callbackOrigin, payload.callbackMode);
}

// Chamado pela aba autenticada com google.script.run; o navegador local não faz POST oculto.
function syncOrders(payload) {
    var spreadsheet;
    var lock;
    try {
        if (serverMode_() && (!payload || payload.serverToken !== PropertiesService.getScriptProperties().getProperty('DROPTECH_SERVER_TOKEN')))
            throw new Error('Envio não autorizado.');
        if (JSON.stringify(payload).length > 2000000) throw new Error('Envio muito grande. Selecione menos pedidos.');
        validatePayload_(payload);
        if (payload.requestId && !/^[a-zA-Z0-9-]{1,80}$/.test(payload.requestId)) throw new Error('Identificação de envio inválida.');
        if (payload.callbackOrigin && payload.callbackOrigin !== 'null' && !/^https?:\/\/[^/\s]+$/.test(payload.callbackOrigin))
            throw new Error('Origem de confirmação inválida.');
        if (payload.callbackMode && payload.callbackMode !== 'popup' && payload.callbackMode !== 'frame') throw new Error('Modo de confirmação inválido.');
        var orders = payload.orders;
        // O bloqueio serializa vendedores e protege contra duplicação em envios simultâneos.
        lock = LockService.getScriptLock();
        lock.waitLock(30000);
        var properties = PropertiesService.getScriptProperties();
        var spreadsheetId = properties.getProperty('DROPTECH_SPREADSHEET_ID');
        if (spreadsheetId) spreadsheet = SpreadsheetApp.openById(spreadsheetId);
        else {
            spreadsheet = SpreadsheetApp.create('DropTech - Pedidos', 100, 11);
            properties.setProperty('DROPTECH_SPREADSHEET_ID', spreadsheet.getId());
            spreadsheet.getSheets()[0].setName('Consulta de pedidos');
        }
        spreadsheet.setSpreadsheetLocale('pt_BR');
        spreadsheet.setSpreadsheetTimeZone('America/Sao_Paulo');
        var summary = spreadsheet.getSheetByName('Consulta de pedidos') || spreadsheet.insertSheet('Consulta de pedidos');
        var registry = spreadsheet.getSheetByName('_DropTech controle');
        if (!registry) {
            registry = spreadsheet.insertSheet('_DropTech controle');
            prepareNewSheet_(registry, 101, 11);
            registry.getRange('A1:K1').setValues([['ID', 'Guia', 'Data ISO', 'Cliente', 'CNPJ', 'Responsável', 'Telefone', 'Itens', 'Total', 'Pagamento', 'Estado']]);
            registry.hideSheet();
        }
        var entries = readRegistry_(registry);
        var byId = Object.create(null);
        entries.forEach(function(entry) { byId[entry.order.id] = entry; });
        orders.forEach(function(order) {
            var entry = byId[order.id];
            var sheet = entry && spreadsheet.getSheets().filter(function(candidate) { return candidate.getSheetId() === entry.sheetId; })[0];
            if (sheet && entry.state === 'complete') return;
            var created = !sheet;
            if (!entry) {
                entry = { row: registry.getLastRow() + 1, order: order };
                entries.push(entry);
                byId[order.id] = entry;
            }
            if (!sheet) {
                sheet = spreadsheet.insertSheet(sheetName_(order, entry.row - 2));
            } else {
                sheet.setFrozenRows(0);
                sheet.getRange(1, 1, Math.max(sheet.getLastRow(), order.items.length + 30), 6).breakApart().clear();
            }
            entry.sheetId = sheet.getSheetId();
            entry.order = order;
            // Registra a guia antes de preenchê-la: uma tentativa posterior reaproveita guias parciais.
            writeRegistry_(registry, entry, 'writing');
            if (created) prepareNewSheet_(sheet, order.items.length + 30, 6);
            else ensureRows_(sheet, order.items.length + 30);
            writeOrder_(sheet, order, spreadsheet.getUrl(), summary.getSheetId());
            writeRegistry_(registry, entry, 'complete');
        });
        var completed = entries.filter(function(entry) { return entry.state === 'complete'; });
        var selections = readSelections_(summary);
        var filter = summary.getFilter();
        var criteria = [];
        if (filter) {
            for (var column = 1; column <= 11; column++) criteria.push(filter.getColumnFilterCriteria(column));
            filter.remove();
        }
        summary.setFrozenRows(0);
        summary.setFrozenColumns(0);
        ensureRows_(summary, Math.max(summary.getLastRow(), completed.length + 6));
        summary.getRange(1, 1, Math.max(summary.getLastRow(), completed.length + 6), 11).breakApart().clear();
        writeSummary_(summary, completed.map(function(entry) { return entry.order; }), completed.map(function(entry) {
            return spreadsheet.getUrl() + '#gid=' + entry.sheetId;
        }), selections);
        criteria.forEach(function(criterion, index) { if (criterion) summary.getFilter().setColumnFilterCriteria(index + 1, criterion); });
        spreadsheet.setActiveSheet(summary);
        SpreadsheetApp.flush();
        return { channel: 'droptech-google-sync', requestId: payload.requestId, ok: true,
            message: orders.length + ' pedido(s) confirmado(s). Esta planilha é atualizada a cada envio.',
            orderIds: orders.map(function(order) { return order.id; }), spreadsheetUrl: spreadsheet.getUrl() };
    } catch (error) {
        return { channel: 'droptech-google-sync', requestId: payload && payload.requestId, ok: false,
            message: String(error.message || error), orderIds: [], spreadsheetUrl: spreadsheet ? spreadsheet.getUrl() : '' };
    } finally {
        if (lock && lock.hasLock()) lock.releaseLock();
    }
}

function getConnectionInfo() {
    if (serverMode_()) throw new Error('Consulta disponível somente no sistema autenticado.');
    var id = PropertiesService.getScriptProperties().getProperty('DROPTECH_SPREADSHEET_ID');
    return { spreadsheetUrl: id ? SpreadsheetApp.openById(id).getUrl() : '' };
}

// In cloud mode, only the Supabase function knows this token. It must never be in the site code.
function serverMode_() { return !!PropertiesService.getScriptProperties().getProperty('DROPTECH_SERVER_TOKEN'); }
function serverPost_(e) {
    var result;
    try {
        var expected = PropertiesService.getScriptProperties().getProperty('DROPTECH_SERVER_TOKEN');
        if (!expected || expected.length < 32) throw new Error('Token do servidor não configurado corretamente.');
        if (!e || !e.postData || e.postData.contents.length > 2000000) throw new Error('Requisição inválida.');
        var body = JSON.parse(e.postData.contents);
        if (body.serverToken !== expected) throw new Error('Envio não autorizado.');
        body.payload.serverToken = expected;
        result = syncOrders(body.payload);
    } catch (error) { result = { ok: false, message: String(error.message || error), orderIds: [] }; }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function connectionPage_(parameters) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(parameters.nonce || '') ||
        (parameters.origin !== 'null' && !/^https?:\/\/[^/\s]+$/.test(parameters.origin || '')))
        return resultPage_('Conexão inválida', 'Abra esta aba pelo botão Conectar ao Google no sistema.', '');
    var config = JSON.stringify({ nonce: parameters.nonce, origin: parameters.origin }).replace(/</g, '\\u003c');
    return HtmlService.createHtmlOutput('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">' +
        '<style>body{font:16px/1.6 Arial;background:#f1f5f9;color:#1e293b;padding:32px}main{max-width:720px;margin:40px auto;background:white;padding:32px;border-radius:12px}h1{color:#1e40af}a{color:#1d4ed8}</style></head>' +
        '<body><main><h1>DropTech — conexão com o Google</h1><p id="state">Verificando acesso à conta…</p>' +
        '<p>Mantenha esta aba aberta e volte ao sistema. Com o envio automático ativado, os novos pedidos serão enviados ao salvar.</p>' +
        '<a id="sheet" hidden rel="noopener">Abrir planilha</a></main><script>(' + connectionClient_.toString() + ')(' + config + ');</script></body></html>')
        .setTitle('DropTech - Conexão Google');
}

function connectionClient_(config) {
    var opener;
    try { opener = window.top.opener; } catch (error) {}
    var state = document.getElementById('state');
    var link = document.getElementById('sheet');
    var ready = false, linked = false, busy = false, spreadsheetUrl = '';
    function post(data) {
        data.nonce = config.nonce;
        try {
            if (opener && !opener.closed) opener.postMessage(data, config.origin === 'null' ? '*' : config.origin);
            else state.textContent = 'O sistema foi fechado. Reabra-o e clique em Conectar ao Google.';
        } catch (error) { state.textContent = 'O navegador interrompeu a comunicação com o sistema. Volte ao sistema e conecte novamente.'; }
    }
    function showLink(url) {
        if (/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+(?:\/edit)?(?:#gid=\d+)?$/.test(url || '')) {
            spreadsheetUrl = url; link.href = url; link.hidden = false;
        }
    }
    function announce() {
        if (ready) post({ channel: 'droptech-google-bridge', type: 'ready', protocol: 2, spreadsheetUrl: spreadsheetUrl });
    }
    if (!opener) {
        state.textContent = 'A conexão com o sistema foi interrompida pelo navegador. Volte ao sistema e clique em Conectar ao Google novamente, depois de concluir o login.';
        return;
    }
    window.addEventListener('message', function(event) {
        var data = event.data;
        if (event.source !== opener || event.origin !== config.origin || !data || data.nonce !== config.nonce || !ready) return;
        if (data.channel === 'droptech-google-connected') {
            if (!linked) state.textContent = 'Conectado. Volte ao sistema; mantenha esta aba aberta durante o uso.';
            linked = true; return;
        }
        if (data.channel !== 'droptech-google-send' || busy) return;
        busy = true; state.textContent = 'Salvando pedido(s) na planilha…';
        var payload = data.payload;
        try {
            google.script.run.withSuccessHandler(function(result) {
                busy = false; showLink(result.spreadsheetUrl);
                state.textContent = result.ok ? 'Pedido(s) confirmado(s). Pode continuar cadastrando no sistema.' : 'Falha: ' + result.message;
                post(result);
            }).withFailureHandler(function(error) {
                busy = false;
                var message = String(error.message || error);
                state.textContent = 'Falha: ' + message;
                post({ channel: 'droptech-google-sync', requestId: payload && payload.requestId, ok: false, message: message, orderIds: [] });
            }).syncOrders(payload);
        } catch (error) {
            busy = false; state.textContent = 'Falha: ' + String(error.message || error);
            post({ channel: 'droptech-google-sync', requestId: payload && payload.requestId, ok: false, message: state.textContent, orderIds: [] });
        }
    });
    google.script.run.withSuccessHandler(function(info) {
        ready = true; showLink(info.spreadsheetUrl);
        state.textContent = 'Acesso autorizado. Aguardando confirmação da conexão com o sistema…';
        announce(); setInterval(announce, 5000);
    }).withFailureHandler(function(error) {
        state.textContent = 'Não foi possível conectar: ' + String(error.message || error);
        post({ channel: 'droptech-google-bridge', type: 'error', protocol: 2, message: state.textContent });
    }).getConnectionInfo();
}

function ensureRows_(sheet, rows) {
    if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
}

function prepareNewSheet_(sheet, rows, columns) {
    // Reduz apenas guias recém-criadas e vazias, para permitir muitos pedidos na mesma planilha.
    if (sheet.getMaxRows() > rows) sheet.deleteRows(rows + 1, sheet.getMaxRows() - rows);
    else ensureRows_(sheet, rows);
    if (sheet.getMaxColumns() > columns) sheet.deleteColumns(columns + 1, sheet.getMaxColumns() - columns);
}

function readRegistry_(sheet) {
    if (sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues().map(function(row, index) {
        return { row: index + 2, sheetId: Number(row[1]), state: row[10], order: {
            id: String(row[0]), createdAt: String(row[2]), client: JSON.parse(String(row[3])), cnpj: JSON.parse(String(row[4])),
            buyer: JSON.parse(String(row[5])), phone: JSON.parse(String(row[6])), items: { length: Number(row[7]) }, final: Number(row[8]), payment: JSON.parse(String(row[9]))
        } };
    }).filter(function(entry) { return entry.order.id; });
}

function writeRegistry_(sheet, entry, state) {
    var order = entry.order;
    ensureRows_(sheet, entry.row);
    sheet.getRange(entry.row, 1, 1, 11).setNumberFormat('@').setValues([[order.id, entry.sheetId,
        orderDate_(order).toISOString(), JSON.stringify(order.client), JSON.stringify(order.cnpj), JSON.stringify(order.buyer), JSON.stringify(order.phone),
        order.items.length, order.final, JSON.stringify(order.payment), state]]);
    entry.state = state;
}

function readSelections_(sheet) {
    var selected = Object.create(null);
    if (sheet.getLastRow() < 7) return selected;
    sheet.getRange(7, 1, sheet.getLastRow() - 6, 2).getValues().forEach(function(row) { selected[row[1]] = row[0] === true; });
    return selected;
}

function validatePayload_(payload) {
    if (!payload || payload.version !== 1 || !Array.isArray(payload.orders) || !payload.orders.length)
        throw new Error('Formato de pedidos inválido.');
    if (payload.orders.length > 100) throw new Error('Envie até 100 pedidos por vez.');
    var ids = {};
    payload.orders.forEach(function(order) {
        if (!order || !/^[a-zA-Z0-9-]{1,80}$/.test(order.id || '') || ids[order.id])
            throw new Error('Pedido sem identificação válida ou duplicado.');
        ids[order.id] = true;
        ['client', 'cnpj', 'buyer', 'phone', 'payment', 'date'].forEach(function(key) {
            if (typeof order[key] !== 'string' || !order[key].trim() || order[key].length > 1000)
                throw new Error('Campo inválido no pedido: ' + key);
        });
        if (!Array.isArray(order.items) || !order.items.length || order.items.length > 500)
            throw new Error('Cada pedido precisa ter de 1 a 500 itens.');
        order.items.forEach(function(item) {
            if (typeof item.product !== 'string' || typeof item.detail !== 'string' || item.product.length > 1000 || item.detail.length > 1000)
                throw new Error('Descrição de produto inválida.');
            ['meters', 'unitPrice', 'subtotal'].forEach(function(key) {
                if (typeof item[key] !== 'number' || !isFinite(item[key]) || item[key] < 0)
                    throw new Error('Valor de item inválido: ' + key);
            });
            if (item.meters <= 0 || Math.abs(item.meters * item.unitPrice - item.subtotal) > 0.01)
                throw new Error('Metragem ou subtotal inconsistente.');
        });
        ['gross', 'discountPct', 'discountVal', 'final'].forEach(function(key) {
            if (typeof order[key] !== 'number' || !isFinite(order[key]) || order[key] < 0)
                throw new Error('Total inválido no pedido: ' + key);
        });
        var gross = order.items.reduce(function(sum, item) { return sum + item.subtotal; }, 0);
        if (order.discountPct > 100 || Math.abs(gross - order.gross) > 0.01 ||
            Math.abs(gross * order.discountPct / 100 - order.discountVal) > 0.01 ||
            Math.abs(order.gross - order.discountVal - order.final) > 0.01)
            throw new Error('Os totais do pedido não conferem.');
        orderDate_(order);
    });
}

function sheetName_(order, index) {
    var client = order.client.replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 65);
    return String(index + 1).padStart(3, '0') + ' - ' + (client || 'Cliente');
}

function orderNumber_(order) {
    return 'DT-' + order.id.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function orderDate_(order) {
    var date;
    if (order.createdAt) date = new Date(order.createdAt);
    else {
        var parts = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/.exec(order.date);
        if (!parts) throw new Error('Data inválida no pedido.');
        date = new Date(parts[3] + '-' + parts[2] + '-' + parts[1] + 'T' + parts[4] + ':' + parts[5] + ':00-03:00');
    }
    if (!isFinite(date.getTime())) throw new Error('Data inválida no pedido.');
    return date;
}

// Entradas de clientes sempre são texto, nunca fórmulas executáveis.
function text_(value) {
    var text = String(value == null ? '' : value);
    return /^\s*[=+@\-']/.test(text) ? "'" + text : text;
}

function writeOrder_(sheet, order, url, summaryId) {
    var currency = '"R$" #,##0.00';
    sheet.setHiddenGridlines(true);
    sheet.getRange('A1:F1').merge().setValue('DropTech - Pedido comercial').setFontSize(20).setFontColor('#ffffff').setBackground('#1e40af');
    sheet.getRange('A2:F2').merge().setValue(orderNumber_(order)).setFontWeight('bold');
    var metadata = [
        ['Data', orderDate_(order)], ['Empresa / Comprador', text_(order.client)], ['CNPJ', text_(order.cnpj)],
        ['Inscrição estadual', text_(order.ie || 'Não informada')], ['Responsável', text_(order.buyer)],
        ['Telefone / WhatsApp', text_(order.phone)], ['Pagamento', text_(order.payment)]
    ];
    metadata.forEach(function(row, index) {
        sheet.getRange(index + 4, 1).setValue(row[0]).setFontWeight('bold');
        var value = sheet.getRange(index + 4, 2, 1, 5).merge();
        if (row[1] instanceof Date) value.setValue(row[1]).setNumberFormat('dd/mm/yyyy hh:mm');
        else value.setNumberFormat('@').setValue(row[1]);
    });
    sheet.getRange('A12:F12').setValues([['Produto', 'Composição', 'Metros', 'Preço / m (R$)', 'Subtotal (R$)', '']])
        .setBackground('#dbeafe').setFontWeight('bold');
    var rows = order.items.map(function(item) { return [text_(item.product), text_(item.detail), item.meters, item.unitPrice, item.subtotal, '']; });
    sheet.getRange(13, 1, rows.length, 2).setNumberFormat('@');
    sheet.getRange(13, 1, rows.length, 6).setValues(rows);
    sheet.getRange(13, 3, rows.length, 1).setNumberFormat('#,##0.00');
    sheet.getRange(13, 4, rows.length, 1).setNumberFormat('0.0000');
    sheet.getRange(13, 5, rows.length, 1).setNumberFormat(currency);
    var totalRow = 14 + rows.length;
    var totals = [['Total bruto', order.gross], ['Desconto (%)', order.discountPct / 100],
        ['Desconto (R$)', order.discountVal], ['Total final', order.final]];
    sheet.getRange(totalRow, 4, 4, 2).setValues(totals);
    sheet.getRange(totalRow, 5, 4, 1).setNumberFormat(currency);
    sheet.getRange(totalRow + 1, 5).setNumberFormat('0.0%');
    sheet.getRange(totalRow + 3, 4, 1, 2).setBackground('#d1fae5').setFontWeight('bold').setFontSize(14);
    sheet.getRange(totalRow + 5, 1, 1, 6).merge().setValue('Pedido comercial. Documento sem valor fiscal.').setFontColor('#64748b');
    sheet.getRange(totalRow + 7, 1).setRichTextValue(SpreadsheetApp.newRichTextValue().setText('Voltar à consulta')
        .setLinkUrl(url + '#gid=' + summaryId).build());
    sheet.getRange(1, 1, totalRow + 8, 6).setFontFamily('Arial').setVerticalAlignment('middle').setWrap(true);
    sheet.setColumnWidth(1, 310).setColumnWidth(2, 250).setColumnWidths(3, 3, 120).setColumnWidth(6, 30);
    sheet.setFrozenRows(12);
    sheet.autoResizeRows(1, totalRow + 8);
}

function writeSummary_(sheet, orders, links, selections) {
    selections = selections || {};
    var last = 6 + orders.length;
    var currency = '"R$" #,##0.00';
    sheet.setHiddenGridlines(true);
    sheet.getRange('A1:K1').merge().setValue('DropTech - Consulta de pedidos').setFontSize(20)
        .setBackground('#1e40af').setFontColor('#ffffff');
    sheet.getRange('A2:K2').merge().setValue('Pesquise nos filtros do cabeçalho. Clique em “Abrir pedido” para acessar a aba individual.');
    sheet.getRange('A3').setValue('Pedidos');
    sheet.getRange('B3').setValue(orders.length);
    sheet.getRange('D3').setValue('Total dos pedidos');
    sheet.getRange('E3').setFormula('=SUM(I7:I' + last + ')').setNumberFormat(currency);
    sheet.getRange('G3').setValue('Selecionados');
    // A localidade pt_BR usa ponto e vírgula entre os argumentos das fórmulas.
    sheet.getRange('H3').setFormula('=COUNTIF(A7:A' + last + ';TRUE)');
    sheet.getRange('J3').setValue('Total selecionado');
    sheet.getRange('K3').setFormula('=SUMIF(A7:A' + last + ';TRUE;I7:I' + last + ')').setNumberFormat(currency);
    sheet.getRange('A4:K4').merge().setValue('No filtro de Cliente ou CNPJ, use a caixa de pesquisa. As caixas de seleção abaixo servem para conferir o total dos pedidos escolhidos.');
    var headers = [['Selecionar', 'Pedido', 'Data', 'Cliente', 'CNPJ', 'Responsável', 'Telefone', 'Itens', 'Total final', 'Pagamento', 'Acessar']];
    sheet.getRange('A6:K6').setValues(headers).setFontWeight('bold').setBackground('#dbeafe');
    var rows = orders.map(function(order) {
        return [selections[orderNumber_(order)] === true, orderNumber_(order), orderDate_(order), text_(order.client), text_(order.cnpj),
            text_(order.buyer), text_(order.phone), order.items.length, order.final, text_(order.payment), 'Abrir pedido'];
    });
    sheet.getRange(7, 4, orders.length, 4).setNumberFormat('@');
    sheet.getRange(7, 10, orders.length, 1).setNumberFormat('@');
    sheet.getRange(7, 1, orders.length, 1).insertCheckboxes();
    sheet.getRange(7, 1, orders.length, 11).setValues(rows);
    sheet.getRange(7, 3, orders.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.getRange(7, 9, orders.length, 1).setNumberFormat(currency);
    sheet.getRange(7, 11, orders.length, 1).setRichTextValues(links.map(function(link) {
        return [SpreadsheetApp.newRichTextValue().setText('Abrir pedido').setLinkUrl(link).build()];
    }));
    sheet.getRange(6, 1, orders.length + 1, 11).createFilter();
    sheet.setFrozenRows(6);
    // As mesclagens A1:K1, A2:K2 e A4:K4 impedem congelar só parte das colunas.
    sheet.setFrozenColumns(0);
    var widths = [100, 320, 160, 240, 170, 190, 160, 65, 150, 200, 150];
    widths.forEach(function(width, index) { sheet.setColumnWidth(index + 1, width); });
    sheet.getRange(1, 1, last, 11).setFontFamily('Arial').setVerticalAlignment('middle').setWrap(true);
    sheet.autoResizeRows(1, last);
}

function resultPage_(title, message, url, confirmation, callbackOrigin, callbackMode) {
    function escape(value) { return String(value).replace(/[&<>"']/g, function(char) {
        return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char];
    }); }
    var callback = '';
    if (confirmation && confirmation.requestId && callbackOrigin) {
        var target = callbackOrigin === 'null' ? '*' : callbackOrigin;
        // Escapa também '<' para que entradas não possam encerrar a tag script.
        var destination = callbackMode === 'popup' ? 'window.top.opener' : 'window.top';
        callback = '<script>try{var destination=' + destination + ';if(destination)destination.postMessage(' + JSON.stringify(confirmation).replace(/</g, '\\u003c') + ',' +
            JSON.stringify(target).replace(/</g, '\\u003c') + ');}catch(error){}</script>';
    }
    return HtmlService.createHtmlOutput('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank">' +
        '<style>body{font:16px/1.6 Arial,sans-serif;background:#f1f5f9;color:#1e293b;margin:0;padding:32px}' +
        'main{max-width:720px;margin:40px auto;background:white;padding:32px;border-radius:12px}h1{color:#1e40af}' +
        'a{display:inline-block;background:#2563eb;color:white;padding:12px 20px;border-radius:8px;text-decoration:none}</style></head>' +
        '<body><main><h1>' + escape(title) + '</h1><p>' + escape(message) + '</p>' +
        (url ? '<a rel="noopener" href="' + escape(url) + '">Abrir planilha</a>' : '') +
        '</main>' + callback + '</body></html>').setTitle('DropTech - Google Planilhas')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

module.exports = function googleContext() {
    const calls = [], books = new Map(), properties = new Map();
    let nextSheetId = 0, locale = 'en_US', created = 0, held = false;
    const mock = { calls, books, properties, fail: null, lockEvents: [] };
    function bounds(address) {
        if (typeof address[0] === 'number') {
            const [row, column, rows = 1, columns = 1] = address;
            return { row, column, endRow: row + rows - 1, endColumn: column + columns - 1 };
        }
        const cells = address[0].split(':').map(cell => {
            const match = /^([A-Z]+)(\d+)$/.exec(cell);
            return { row: Number(match[2]), column: [...match[1]].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) };
        });
        return { ...cells[0], endRow: (cells[1] || cells[0]).row, endColumn: (cells[1] || cells[0]).column };
    }
    class Sheet {
        constructor(book, name, rows = 1000, columns = 26) {
            this.book = book; this.name = name; this.id = nextSheetId++; this.merged = [];
            this.frozenRows = 0; this.frozenColumns = 0; this.rows = rows; this.columns = columns;
            this.cells = new Map(); this.filter = null; book.sheets.push(this);
        }
        setName(name) { this.name = name; return this; }
        getSheetId() { return this.id; }
        getCell(row, column) { return this.cells.get(row + ',' + column) ?? ''; }
        getLastRow() { return Math.max(0, ...[...this.cells.keys()].map(key => Number(key.split(',')[0]))); }
        getMaxRows() { return this.rows; }
        getMaxColumns() { return this.columns; }
        insertRowsAfter(_, count) { this.rows += count; return this; }
        deleteRows(_, count) { this.rows -= count; return this; }
        deleteColumns(_, count) { this.columns -= count; return this; }
        hideSheet() { this.hidden = true; return this; }
        getFilter() { return this.filter; }
        getRange(...address) {
            const sheet = this, range = bounds(address);
            if (range.endRow > sheet.rows || range.endColumn > sheet.columns) throw new Error('Intervalo fora da grade.');
            function cells(fn) {
                for (let r = range.row; r <= range.endRow; r++) for (let c = range.column; c <= range.endColumn; c++) fn(r, c);
            }
            return new Proxy({}, { get(_, method) { return (...args) => {
                const call = { sheet: sheet.name, address, method, args, lockHeld: held };
                if (mock.fail?.(call)) throw new Error('Falha simulada durante o preenchimento');
                if (method === 'getValues') {
                    return Array.from({ length: range.endRow - range.row + 1 }, (_, r) =>
                        Array.from({ length: range.endColumn - range.column + 1 }, (_, c) => sheet.getCell(range.row + r, range.column + c)));
                }
                if (method === 'merge') {
                    sheet.merged.push(range); sheet.checkFreeze('row', sheet.frozenRows); sheet.checkFreeze('column', sheet.frozenColumns);
                }
                if (method === 'breakApart') sheet.merged = sheet.merged.filter(other =>
                    other.endRow < range.row || other.row > range.endRow || other.endColumn < range.column || other.column > range.endColumn);
                if (method === 'clear') cells((r, c) => sheet.cells.delete(r + ',' + c));
                if (method === 'setFormula' && locale === 'pt_BR' && args[0].includes(',')) throw new Error('Erro de análise de fórmula: separador incompatível com pt_BR.');
                if (method === 'setValue' || method === 'setFormula') sheet.cells.set(range.row + ',' + range.column, args[0]);
                if (method === 'insertCheckboxes') cells((r, c) => sheet.cells.set(r + ',' + c, false));
                if (method === 'setValues' || method === 'setRichTextValues') {
                    if (args[0].length !== range.endRow - range.row + 1 || args[0].some(row => row.length !== range.endColumn - range.column + 1))
                        throw new Error('Dimensão de valores inválida.');
                    args[0].forEach((row, r) => row.forEach((value, c) => sheet.cells.set((range.row + r) + ',' + (range.column + c), method === 'setRichTextValues' ? value.text : value)));
                }
                if (method === 'setRichTextValue') sheet.cells.set(range.row + ',' + range.column, args[0].text);
                if (method === 'createFilter') {
                    if (sheet.filter) throw new Error('Já existe filtro.');
                    const criteria = new Map();
                    sheet.filter = { getColumnFilterCriteria: c => criteria.get(c) || null,
                        setColumnFilterCriteria(c, value) { criteria.set(c, value); return this; }, remove() { sheet.filter = null; } };
                }
                calls.push(call);
                return sheet.getRange(...address);
            }; } });
        }
        checkFreeze(axis, count) {
            const end = axis === 'row' ? 'endRow' : 'endColumn';
            if (count > 0 && this.merged.some(range => range[axis] <= count && range[end] > count)) throw new Error('Não é possível congelar apenas parte de uma célula mesclada.');
        }
        setFrozenRows(count) { this.checkFreeze('row', count); this.frozenRows = count; return this; }
        setFrozenColumns(count) { this.checkFreeze('column', count); this.frozenColumns = count; return this; }
        setHiddenGridlines() { return this; }
        setColumnWidth() { return this; }
        setColumnWidths() { return this; }
        autoResizeRows() { return this; }
    }
    function newBook(id, rows, columns) {
        const book = { id, sheets: [], getId: () => id, getSheets() { return this.sheets; },
            getSheetByName(name) { return this.sheets.find(sheet => sheet.name === name) || null; },
            insertSheet(name) { if (this.getSheetByName(name)) throw new Error('Nome duplicado.'); return new Sheet(this, name); },
            getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
            setSpreadsheetLocale(value) { locale = value; }, setSpreadsheetTimeZone() {}, setActiveSheet() {} };
        books.set(id, book); new Sheet(book, 'Sheet1', rows, columns); return book;
    }
    // Uma planilha de apoio permite testes isolados do simulador sem criar a planilha de produção.
    const support = newBook('support', 1000, 26); nextSheetId = 0;
    books.delete('support');
    const context = vm.createContext({
        SpreadsheetApp: { create: (_, rows = 1000, columns = 26) => {
            created++; const book = newBook(created === 1 ? 'test' : 'test' + created, rows, columns);
            mock.spreadsheet = book; mock.sheets = book.sheets; return book;
        }, openById: id => { if (!books.has(id)) throw new Error('Planilha sem acesso'); return books.get(id); }, flush() {},
            newRichTextValue: () => { const rich = {}; return { setText(value) { rich.text = value; return this; },
                setLinkUrl(value) { rich.url = value; return this; }, build() { return rich; } }; } },
        PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value) }) },
        LockService: { getScriptLock: () => ({ waitLock() { if (held) throw new Error('Bloqueio ocupado'); held = true; mock.lockEvents.push('acquired'); },
            hasLock: () => held, releaseLock() { held = false; mock.lockEvents.push('released'); } }) },
        Utilities: { formatDate: () => '05-10-2026 14:30:00' },
        ContentService: { MimeType: {JSON:'application/json'}, createTextOutput: text=>({text,setMimeType(value){this.mime=value;return this;}}) },
        HtmlService: { XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }, createHtmlOutput: html => ({ html, setTitle() { return this; }, setXFrameOptionsMode(mode) { this.mode = mode; return this; } }) }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-apps-script.gs'), 'utf8'), context);
    mock.context = context; mock.spreadsheet = support; mock.sheets = support.sheets;
    Object.defineProperty(mock, 'created', { get: () => created });
    return mock;
};

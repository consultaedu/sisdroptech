const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'app.css', 'assets/droptech-logo.png', 'order-tools.js', 'order-pdf.js', 'vendor/pdf-lib-1.17.1.min.js', 'google-sync.js', 'order-print.css', 'GOOGLE-PLANILHAS.md']);
http.createServer((req, res) => {
    if (req.url === '/print-preview') {
        const tools = require('../order-tools.js');
        const order = { id: 'exemplo', date: '05/10/2026 14:30', client: 'Cliente Demonstração', cnpj: '00.000.000/0001-00',
            ie: 'Não informada', buyer: 'Responsável de teste', phone: '(00) 00000-0000', payment: 'Boleto Bancário em 3x',
            items: [{ product: 'Mangueira Cristal 1/2 x 1,80mm', detail: '100m (Livre)', meters: 100, unitPrice: 2.125, subtotal: 212.5 }],
            gross: 212.5, discountPct: 10, discountVal: 21.25, final: 191.25 };
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Prévia PDF de demonstração</title>' +
            '<link rel="stylesheet" href="order-print.css"><body style="background:#f1f5f9">' +
            '<article id="printOrder" style="max-width:794px;margin:24px auto">' + tools.printHtml(order) + '</article></body></html>');
        return;
    }
    const filename = req.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0].slice(1));
    if (!files.has(filename)) { res.writeHead(404); res.end('Não encontrado'); return; }
    const types = { '.png': 'image/png', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/plain' };
    res.setHeader('Content-Type', (types[path.extname(filename)] || 'text/plain') + '; charset=utf-8');
    fs.createReadStream(path.join(root, filename)).pipe(res);
}).listen(4173, '127.0.0.1', () => console.log('Prévia: http://localhost:4173'));

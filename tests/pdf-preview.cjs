const fs = require('node:fs');
const path = require('node:path');
require('../order-tools.js');
const pdf = require('../order-pdf.js');
const library = require('../vendor/pdf-lib-1.17.1.min.js');

const directory = path.join(__dirname, '..', 'tmp', 'pdfs');
const order = { id: 'exemplo-pdf', date: '05/10/2026 14:30', client: 'Comércio São José',
    cnpj: '01.234.567/0001-00', ie: 'Isento', buyer: 'Maria de Oliveira', phone: '(27) 99999-9999',
    payment: 'Boleto Bancário em 3x', items: [
        { product: 'Mangueira Cristal 1/2 x 1,80mm', detail: '2 rolos de 50m', meters: 100, unitPrice: 2.125, subtotal: 212.5 },
        { product: 'MANGUEIRA JARDIM TRANÇADA ½ X 2,50mm', detail: '50m (Livre)', meters: 50, unitPrice: 3.75, subtotal: 187.5 }
    ], gross: 400, discountPct: 10, discountVal: 40, final: 360 };

(async () => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'pedido-simples.pdf'), await pdf.build(order, library));
    const items = Array.from({ length: 60 }, (_, index) => ({ ...order.items[0],
        product: `ITEM ${String(index + 1).padStart(3, '0')} - Mangueira Cristal com descrição comercial longa para testar a composição e quebra de linhas do pedido`,
        detail: 'Composição: 2 rolos de 50m - Observação do comprador com acentos: entrega na São José.' }));
    fs.writeFileSync(path.join(directory, 'pedido-varias-paginas.pdf'), await pdf.build({ ...order, items,
        gross: 12750, discountVal: 1275, final: 11475 }, library));
    console.log('PDFs de demonstração:', directory);
})().catch(error => { console.error(error); process.exitCode = 1; });

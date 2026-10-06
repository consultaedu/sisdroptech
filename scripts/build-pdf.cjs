/* Regera o arquivo único de PDF servido pelo sistema; dispensa instalação de pacotes. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const library = fs.readFileSync(path.join(root, 'vendor', 'pdf-lib-1.17.1.min.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'order-pdf.source.js'), 'utf8').replace(/^\uFEFF/, '');
// Isola a detecção UMD: páginas com AMD/CommonJS também recebem PDFLib no global correto.
const bundle = '/* PDF DropTech: pdf-lib 1.17.1 (MIT, vendor/pdf-lib-LICENSE.md) + order-pdf.source.js.\n' +
    ' * Gerado por scripts/build-pdf.cjs. Edite a fonte e execute node scripts/build-pdf.cjs. */\n' +
    '(function (root) {\nvar exports = {}; var module = { exports: exports }; var define;\n' +
    library + '\nroot.PDFLib = module.exports;\n})(typeof globalThis !== "undefined" ? globalThis : window);\n' + source;
fs.writeFileSync(path.join(root, 'order-pdf.js'), bundle, 'utf8');
console.log('order-pdf.js gerado com biblioteca incorporada.');

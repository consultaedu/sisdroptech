/* PDF individual em A4. Usa a cópia local de pdf-lib; funciona sem rede ou Google. */
(function (root) {
    function filename(order) {
        const client = String(order.client || 'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'cliente';
        return `${root.OrderTools.orderNumber(order)}-${client}.pdf`;
    }
    async function build(order, library = root.PDFLib) {
        if (!library) throw new Error('Não foi possível carregar o gerador de PDF. Recarregue a página e tente novamente.');
        if (!order || !Array.isArray(order.items)) throw new Error('Pedido inválido para gerar PDF.');
        const { PDFDocument, StandardFonts, rgb } = library;
        const pdf = await PDFDocument.create();
        const regular = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        const width = 595.28, height = 841.89, margin = 40, bottom = 778, content = width - margin * 2;
        const blue = rgb(0.12, 0.25, 0.69), ink = rgb(0.12, 0.16, 0.23), muted = rgb(0.36, 0.42, 0.5);
        const light = rgb(0.94, 0.96, 1), border = rgb(0.8, 0.84, 0.89);
        const tools = root.OrderTools;
        let page, y;
        function clean(value) { return String(value ?? '').normalize('NFC').replace(/\r/g, '').replace(/[\t\u00a0]/g, ' '); }
        function wrap(value, maxWidth, font = regular, size = 10) {
            const output = [];
            clean(value).split('\n').forEach(paragraph => {
                let line = '';
                paragraph.split(/ +/).filter(Boolean).forEach(word => {
                    const candidate = line ? line + ' ' + word : word;
                    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; return; }
                    if (line) { output.push(line); line = ''; }
                    for (const char of word) {
                        if (line && font.widthOfTextAtSize(line + char, size) > maxWidth) { output.push(line); line = ''; }
                        line += char;
                    }
                });
                output.push(line);
            });
            return output.length ? output : [''];
        }
        function text(value, x, top, size = 10, font = regular, color = ink) {
            page.drawText(clean(value), { x, y: height - top - size, size, font, color });
        }
        function rule(top, color = border, thickness = 0.6) {
            page.drawLine({ start: { x: margin, y: height - top }, end: { x: width - margin, y: height - top }, color, thickness });
        }
        function newPage(first = false) {
            page = pdf.addPage([width, height]);
            if (first) {
                text('DropTech', margin, 34, 28, bold, blue);
                text('Indústria e Comércio de Mangueiras', margin, 72, 10);
                text('Pedido comercial', 320, 38, 15, bold, blue);
                const codeLines = wrap(tools.orderNumber(order), 235, regular, 8);
                codeLines.forEach((line, i) => text(line, 320, 61 + i * 10, 8));
                text(order.date, 320, 64 + codeLines.length * 10, 9, regular, muted);
                y = Math.max(106, 83 + codeLines.length * 10);
                rule(y, blue, 2); y += 18;
            } else {
                text('DropTech | Pedido comercial - continuação', margin, 30, 12, bold, blue);
                const codeLines = wrap(tools.orderNumber(order), content, regular, 8);
                codeLines.forEach((line, i) => text(line, margin, 49 + i * 10, 8, regular, muted));
                y = 64 + codeLines.length * 10; rule(y); y += 16;
            }
        }
        function ensure(space) { if (y + space > bottom) newPage(); }
        newPage(true);
        text('Cliente e responsável pela compra', margin, y, 12, bold, blue); y += 25;
        const metadata = [
            ['Empresa / Comprador', order.client], ['CNPJ', order.cnpj],
            ['Inscrição estadual', order.ie || 'Não informada'], ['Responsável', order.buyer],
            ['Telefone / WhatsApp', order.phone], ['Data do pedido', order.date]
        ];
        const fieldWidth = (content - 24) / 2;
        for (let i = 0; i < metadata.length; i += 2) {
            const fields = metadata.slice(i, i + 2).map(([label, value]) => ({ label, lines: wrap(value, fieldWidth) }));
            let offset = 0;
            const count = Math.max(...fields.map(field => field.lines.length));
            while (offset < count) {
                ensure(40);
                const take = Math.min(count - offset, Math.max(1, Math.floor((bottom - y - 24) / 13)));
                fields.forEach((field, col) => {
                    const x = margin + col * (fieldWidth + 24);
                    text(field.label + (offset ? ' (continuação)' : ''), x, y, 8, regular, muted);
                    field.lines.slice(offset, offset + take).forEach((line, index) => text(line, x, y + 15 + index * 13));
                });
                y += 24 + take * 13; offset += take;
            }
        }
        y += 10;
        const columns = [margin, margin + 272, margin + 327, margin + 421, width - margin];
        function tableHeader() {
            page.drawRectangle({ x: margin, y: height - y - 27, width: content, height: 27, color: light });
            ['Produto / composição', 'Metros', 'Preço / m (R$)', 'Subtotal'].forEach((label, index) => text(label, columns[index] + 6, y + 8, 9, bold, blue));
            y += 27;
        }
        ensure(55); tableHeader();
        order.items.forEach(item => {
            const product = wrap(item.product, 260, bold, 10).map(value => ({ value, font: bold, color: ink }));
            const detail = wrap(item.detail, 260, regular, 9).map(value => ({ value, font: regular, color: muted }));
            const lines = [...product, ...detail];
            let offset = 0;
            while (offset < lines.length) {
                if (y + 40 > bottom) { newPage(); tableHeader(); }
                const take = Math.min(lines.length - offset, Math.max(1, Math.floor((bottom - y - 14) / 13)));
                lines.slice(offset, offset + take).forEach((line, index) => text(line.value, margin + 6, y + 7 + index * 13,
                    line.font === bold ? 10 : 9, line.font, line.color));
                if (!offset) {
                    const values = [tools.number(item.meters), Number(item.unitPrice).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }), tools.money(item.subtotal)];
                    values.forEach((value, index) => {
                        const size = 9, cellWidth = columns[index + 2] - columns[index + 1] - 12;
                        const formatted = wrap(value, cellWidth, regular, size);
                        formatted.forEach((line, lineIndex) => text(line, columns[index + 2] - 6 - regular.widthOfTextAtSize(line, size), y + 8 + lineIndex * 12, size));
                    });
                }
                y += 14 + take * 13; rule(y); offset += take;
            }
        });
        const payment = wrap(order.payment, fieldWidth);
        ensure(115); y += 20;
        text('Pagamento', margin, y, 11, bold, blue);
        const totalsX = margin + fieldWidth + 24;
        text('Total bruto', totalsX, y, 10); text(tools.money(order.gross), width - margin - regular.widthOfTextAtSize(clean(tools.money(order.gross)), 10), y, 10);
        text(`Desconto (${tools.number(order.discountPct)}%)`, totalsX, y + 24, 10);
        text(tools.money(order.discountVal), width - margin - regular.widthOfTextAtSize(clean(tools.money(order.discountVal)), 10), y + 24, 10);
        page.drawLine({ start: { x: totalsX, y: height - y - 47 }, end: { x: width - margin, y: height - y - 47 }, color: blue, thickness: 1.2 });
        text('Total final', totalsX, y + 57, 14, bold, blue);
        const total = clean(tools.money(order.final));
        text(total, width - margin - bold.widthOfTextAtSize(total, 14), y + 57, 14, bold, blue);
        let paymentTop = y + 23;
        payment.forEach(line => {
            if (paymentTop + 13 > bottom) { newPage(); paymentTop = y; }
            text(line, margin, paymentTop); paymentTop += 13;
        });
        const pages = pdf.getPages();
        pages.forEach((sheet, index) => {
            page = sheet; rule(796);
            text('Pedido comercial - Documento sem valor fiscal', margin, 805, 8, regular, muted);
            const count = `Página ${index + 1} de ${pages.length}`;
            text(count, width - margin - regular.widthOfTextAtSize(count, 8), 805, 8, regular, muted);
        });
        pdf.setTitle(`${tools.orderNumber(order)} - ${order.client}`);
        pdf.setAuthor('DropTech');
        pdf.setSubject('Pedido comercial individual');
        return pdf.save();
    }
    const api = { build, filename };
    root.OrderPdf = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

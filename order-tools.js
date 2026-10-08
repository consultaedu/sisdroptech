/* Funções compartilhadas pela interface e pelos testes, sem dependências externas. */
(function (root) {
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
    const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const number = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    const orderNumber = order => `DT-${String(order.id).replace(/[^a-z0-9]/gi, '').toUpperCase()}`;
    const searchText = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

    function matches(order, query) {
        const fields = [orderNumber(order), order.date, order.client, order.cnpj, order.buyer, order.phone,
            order.payment, ...(order.items || []).map(item => item.product+' '+(item.observation||''))].join(' ');
        return searchText(fields).includes(searchText(query).trim());
    }

    function printHtml(order) {
        const e = escapeHtml;
        return `<header class="order-header"><div><h1>DropTech</h1><p>Indústria e Comércio de Mangueiras</p></div>
            <div><h2>Pedido comercial</h2><p class="order-code">${e(orderNumber(order))}</p><p>${e(order.date)}</p>${order.revision?'<p>Versão '+e(order.revision)+'</p>':''}</div></header>
            ${order.renewedFromId?'<p class="order-origin">Renovação de '+e(orderNumber({id:order.renewedFromId}))+'</p>':''}
            <section class="customer-details"><h3>Cliente e responsável pela compra</h3>
            <dl><div><dt>Empresa / Comprador</dt><dd>${e(order.client)}</dd></div>
            <div><dt>CNPJ</dt><dd>${e(order.cnpj)}</dd></div>
            <div><dt>Inscrição estadual</dt><dd>${e(order.ie)}</dd></div>
            <div><dt>Responsável</dt><dd>${e(order.buyer)}</dd></div>
            <div><dt>Telefone / WhatsApp</dt><dd>${e(order.phone)}</dd></div></dl></section>
            <table class="order-items"><thead><tr><th>Produto / composição</th><th>Metros</th><th>Preço / m (R$)</th><th>Subtotal</th></tr></thead>
            <tbody>${order.items.map(item => `<tr><td>${e(item.product)}<small>${e(item.detail)}</small>${item.observation?'<small class="item-observation">Observação: '+e(item.observation)+'</small>':''}</td>
            <td>${number(item.meters)}</td><td>${Number(item.unitPrice).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>
            <td>${money(item.subtotal)}</td></tr>`).join('')}</tbody></table>
            <section class="order-closing"><div><h3>Pagamento</h3><p>${e(order.payment)}</p></div>
            <dl><div><dt>Total bruto</dt><dd>${money(order.gross)}</dd></div>
            <div><dt>Desconto (${number(order.discountPct)}%)</dt><dd>${money(order.discountVal)}</dd></div>
            <div class="order-total"><dt>Total final</dt><dd>${money(order.final)}</dd></div></dl></section>
            <footer class="order-footer">Pedido comercial • Documento sem valor fiscal</footer>`;
    }

    function validateGoogleUrl(value) {
        try {
            const url = new URL(value.trim());
            return url.protocol === 'https:' && url.hostname === 'script.google.com' &&
                /^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password;
        } catch { return false; }
    }

    function csv(orders) {
        const cell = value => {
            let text = String(value ?? '');
            if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
            return '"' + text.replace(/"/g, '""') + '"';
        };
        const rows = [['Pedido', 'Data', 'Cliente', 'CNPJ', 'IE', 'Responsável', 'Telefone', 'Itens', 'Total bruto', 'Desconto (%)', 'Total final', 'Pagamento']];
        orders.forEach(order => rows.push([orderNumber(order), order.date, order.client, order.cnpj, order.ie, order.buyer,
            order.phone, order.items.map(item => `${item.product} [${item.detail}]${item.observation?' — Observação: '+item.observation:''}`).join(' | '),
            order.gross, order.discountPct, order.final, order.payment]));
        return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
    }

    function payload(order) {
        const result={};
        for(const key of ['id','createdAt','date','client','cnpj','ie','buyer','phone','items','gross','discountPct','discountVal','final','payment','renewedFromId'])
            if(order[key]!==undefined)result[key]=JSON.parse(JSON.stringify(order[key]));
        return result;
    }
    function changes(before,after) {
        const result=[];
        for(const [key,label] of [['client','Cliente'],['cnpj','CNPJ'],['ie','Inscrição estadual'],['buyer','Responsável'],['phone','Telefone'],['payment','Pagamento'],['discountPct','Desconto (%)'],['final','Total final']])
            if(before[key]!==after[key])result.push(label+': '+String(before[key])+' → '+String(after[key]));
        const a=before.items||[],b=after.items||[];
        for(let i=0;i<Math.max(a.length,b.length);i++){
            if(!a[i]){result.push('Item '+(i+1)+' adicionado: '+b[i].product);continue;}
            if(!b[i]){result.push('Item '+(i+1)+' removido: '+a[i].product);continue;}
            for(const [key,label] of [['product','produto'],['detail','composição'],['meters','metros'],['unitPrice','preço / m'],['observation','observação']])
                if((a[i][key]??'')!==(b[i][key]??''))result.push('Item '+(i+1)+' · '+label+': '+String(a[i][key]??'Sem observação')+' → '+String(b[i][key]??'Sem observação'));
        }
        return result;
    }
    const api = { escapeHtml, money, number, orderNumber, matches, printHtml, validateGoogleUrl, csv, payload, changes,
        newId: () => root.crypto.randomUUID() };
    root.OrderTools = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

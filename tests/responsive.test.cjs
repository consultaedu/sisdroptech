// Run against tests/serve.cjs using an isolated browser context and demonstration data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Exercise the retained local migration/legacy mode without contacting a live backend.
    await page.route('**/backend-config.js*', route=>route.fulfill({contentType:'application/javascript',body:'window.DropTechBackend={enabled:false};'}));
    await page.goto('http://127.0.0.1:4173');
    await page.locator('#clientName').fill('Comercial Jardim · Demonstração');
    await page.locator('#clientCnpj').fill('00.000.000/0001-00');
    await page.locator('#buyerName').fill('Responsável de teste');
    await page.locator('#buyerPhone').fill('(27) 99999-9999');
    await page.locator('#itemProduct').selectOption({index:4});
    await page.locator('#itemMode').selectOption('rolos');
    await page.locator('#itemRollSize').selectOption('50');
    await page.locator('#itemRollQty').fill('2');
    await page.getByRole('button',{name:'Adicionar item'}).click();
    await page.locator('#paymentMethod').selectOption('Boleto Bancário');
    await page.locator('#installmentsCount').selectOption('3');
    await page.locator('#discountPercent').fill('10');
    assert.match(await page.locator('#finalGrandTotalDisplay').innerText(),/427,50/);
    assert.match(await page.locator('#summaryItems').innerText(),/^1 /);
    for (const width of [320,390,768,1024,1440]) {
      await page.setViewportSize({width,height:1000});
      const sizes = await page.evaluate(() => ({scroll:document.documentElement.scrollWidth,width:innerWidth}));
      assert.ok(sizes.scroll <= sizes.width, `Page overflows at ${width}px: ${sizes.scroll}`);
      for (const id of ['clientName','itemProduct','itemRollSize','paymentMethod']) {
        const bounds = await page.locator('#'+id).boundingBox();
        assert.ok(bounds.width>50 && bounds.x>=0 && bounds.x+bounds.width<=width, `${id} clipped at ${width}`);
      }
      if (process.env.SCREENSHOT_DIR && [390,1440].includes(width)) await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`order-${width}.png`),fullPage:true});
    }
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Salvar pedido',exact:true}).click();
    assert.equal(await page.locator('#salesTableBody tr').count(),1);
    assert.equal(await page.locator('#itemMode').inputValue(),'metragem');
    assert.ok(await page.locator('#cartMetragemDiv').isVisible());
    assert.ok(!await page.locator('#cartRolosDiv').isVisible());
    for (const width of [320,390,768,1024,1440]) {
      await page.setViewportSize({width,height:1000});
      await page.locator('#googleSettings').evaluate(el=>el.open=true);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'Saved history or settings overflow at '+width);
    }
    await page.locator('#googleSettings').evaluate(el=>el.open=false);
    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#orderSearch').fill('jardim');
    await page.locator('#selectVisibleOrders').check();
    assert.match(await page.locator('#selectionCount').innerText(),/^1 /);
    if(process.env.SCREENSHOT_DIR) await page.locator('#historico').screenshot({path:path.join(process.env.SCREENSHOT_DIR,'history-mobile.png')});
    await page.getByRole('button',{name:'Ver / PDF'}).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button',{name:'Salvar em PDF',exact:true}).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(),/\.pdf$/);
    assert.equal(await download.failure(),null);
    await page.getByRole('button',{name:'Fechar',exact:true}).click();
    await page.reload();
    assert.equal(await page.locator('#salesTableBody tr').count(),1);
    await page.locator('#orderSearch').fill('inexistente');
    assert.match(await page.locator('#salesTableBody').innerText(),/Nenhum pedido encontrado/);
    assert.deepEqual(errors,[]);
    console.log('PASS: layout 320/390/768/1024/1440px, rolos, desconto, parcelas, salvar, busca, seleção, PDF e persistência.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

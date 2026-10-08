const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:390,height:900}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let mode='success',calls=0,release,last;
 const base='https://test.supabase.co';
 await page.route('**/backend-config.js*',route=>route.fulfill({contentType:'application/javascript',body:"window.DropTechBackend={enabled:true,url:'"+base+"',publishableKey:'sb_publishable_test'};"}));
 await page.route(base+'/**',async route=>{
  const req=route.request(),url=new URL(req.url()),reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'},body:JSON.stringify(body)});
  if(req.method()==='OPTIONS')return reply({});
  assert.equal(url.pathname,'/auth/v1/recover');calls++;last={body:JSON.parse(req.postData()),redirect:url.searchParams.get('redirect_to')};
  const responseMode=mode;
  if(responseMode==='delayed')await new Promise(resolve=>release=resolve);
  if(responseMode==='network')return route.abort('failed');
  if(responseMode==='rate')return reply({message:'Too many requests'},429);
  if(responseMode==='server')return reply({message:'Serviço de e-mail indisponível'},500);
  return reply({});
 });
 try{
  await page.goto('http://127.0.0.1:4173');await page.locator('#loginForm').waitFor({state:'visible'});await page.locator('#recoverButton').click();
  const button=page.locator('#sendRecoveryButton'),email=page.locator('#recoveryEmail'),status=page.locator('#authStatus');
  await button.click();await status.getByText('Informe seu e-mail cadastrado antes de enviar.',{exact:true}).waitFor();assert.equal(calls,0);assert.equal(await email.getAttribute('aria-invalid'),'true');
  await email.fill('sem-arroba');await button.click();await status.getByText(/Informe um e-mail válido/).waitFor();assert.equal(calls,0);
  await email.fill('teste@example.test');mode='delayed';await button.click();await status.getByText(/Solicitando o link/).waitFor();assert.equal(await button.isDisabled(),true);assert.equal(await button.innerText(),'Enviando link…');assert.equal(await page.locator('#recoveryForm').getAttribute('aria-busy'),'true');
  await page.evaluate(()=>document.querySelector('#recoveryForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(calls,1);
  release();await status.getByText(/Solicitação enviada/).waitFor();assert.equal(await status.getAttribute('data-state'),'success');assert.equal(await button.isEnabled(),true);assert.equal(await button.innerText(),'Enviar link de recuperação');assert.deepEqual(last,{body:{email:'teste@example.test'},redirect:'http://127.0.0.1:4173/'});
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'recuperacao-'+width+'.png'),fullPage:true});}
  for(const [responseMode,message] of [['network',/Confira sua conexão/],['rate',/Muitas tentativas/],['server',/Serviço de e-mail indisponível/]]){
   mode=responseMode;await button.click();await status.getByText(message).waitFor();assert.equal(await status.getAttribute('data-state'),'error');assert.equal(await button.isEnabled(),true);
  }
  mode='success';await button.click();await status.getByText(/Solicitação enviada/).waitFor();
  mode='delayed';await button.click();await status.getByText(/Solicitando o link/).waitFor();await page.locator('#cancelRecovery').click();release();await button.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#sendRecoveryButton').disabled===false);assert.equal(await status.innerText(),'Entre com seu usuário e senha.');
  assert.deepEqual(errors,[]);console.log('PASS: campo vazio/inválido, envio em andamento, confirmação, clique repetido, rede, limite, servidor, nova tentativa, resposta tardia e telas 1440/390/320 (envio simulado).');
 }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const contexts=[],errors=[];const base='https://test.supabase.co';let password,updates=0,recoveries=0,dataReads=0;
 async function open(hash,width=390){
  const context=await browser.newContext({viewport:{width,height:900}});contexts.push(context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/backend-config.js*',route=>route.fulfill({contentType:'application/javascript',body:"window.DropTechBackend={enabled:true,url:'"+base+"',publishableKey:'sb_publishable_test'};"}));
  await page.route(base+'/**',async route=>{
   const req=route.request(),url=new URL(req.url()),reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'},body:JSON.stringify(body)});
   if(req.method()==='OPTIONS')return reply({});
   if(url.pathname==='/auth/v1/recover'){recoveries++;return reply({});}
   if(url.pathname.startsWith('/rest/')){dataReads++;return reply({message:'Não deve carregar pedidos enquanto recupera senha'},500);}
   assert.equal(req.headers().authorization,'Bearer fictitious-reset-token');
   if(url.pathname==='/auth/v1/user'){
    if(req.method()==='PUT'){updates++;password=JSON.parse(req.postData()).password;}
    return reply({id:'seller'});
   }
   if(url.pathname==='/auth/v1/logout')return reply({});
   return reply({message:'Endpoint inesperado'},500);
  });
  await page.goto('http://127.0.0.1:4173/'+hash);return page;
 }
 try{
  const valid=await open('#type=recovery&access_token=fictitious-reset-token&refresh_token=fictitious-refresh&expires_in=3600');
  await valid.locator('#passwordForm').waitFor({state:'visible'});assert.equal(await valid.locator('#loginForm').isVisible(),false);assert.equal(new URL(valid.url()).hash,'');
  await valid.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'droptech_auth_test.supabase.co'})));await valid.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.equal(await valid.locator('#passwordForm').isVisible(),true);assert.equal(dataReads,0);
  await valid.locator('#newPassword').fill('1234');await valid.locator('#passwordButton').click();assert.equal(updates,0);
  await valid.locator('#newPassword').fill('nova-senha-ficticia');await valid.locator('#passwordButton').click();await valid.locator('#authStatus').getByText('Senha atualizada. Entre com a nova senha.',{exact:true}).waitFor();
  assert.equal(password,'nova-senha-ficticia');assert.equal(updates,1);assert.equal(await valid.locator('#loginForm').isVisible(),true);assert.equal(await valid.locator('#newPassword').inputValue(),'');assert.equal(await valid.evaluate(()=>localStorage.getItem('droptech_auth_test.supabase.co')),null);
  const expired=await open('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await expired.locator('#authStatus').getByText(/já expirou/).waitFor();assert.equal(await expired.locator('#recoveryForm').isVisible(),true);assert.equal(await expired.locator('#authStatus').getAttribute('data-state'),'error');assert.equal(new URL(expired.url()).hash,'');
  await expired.locator('#recoveryEmail').fill('teste@example.test');await expired.locator('#sendRecoveryButton').click();await expired.locator('#authStatus').getByText(/Solicitação enviada/).waitFor();assert.equal(recoveries,1);
  const incomplete=await open('#type=recovery&access_token=fictitious-incomplete',320);await incomplete.locator('#authStatus').getByText(/incompleto/).waitFor();assert.equal(await incomplete.locator('#passwordForm').isVisible(),false);assert.equal(await incomplete.locator('#recoveryForm').isVisible(),true);
  for(const p of [valid,expired,incomplete])assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);assert.equal(dataReads,0);console.log('PASS: link válido abre nova senha, eventos de outra aba não tiram da recuperação, alteração/logout, link expirado/incompleto com aviso e reenvio, limpeza de URL, mobile (Auth simulada).');
 }finally{for(const context of contexts)await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

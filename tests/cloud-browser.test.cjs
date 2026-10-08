const assert=require('node:assert/strict');const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const accounts=[{id:'admin',email:'admin@example.test',username:'administrador',full_name:'Administrador teste',role:'admin',active:true},{id:'a',email:'a@example.test',username:'vendedor01',full_name:'Vendedor A',role:'seller',active:true},{id:'b',email:'b@example.test',username:'vendedor02',full_name:'Vendedor B',role:'seller',active:true}];
const orders=[];const revisions=[];const settings={environment:'Teste',google_auto_send:false,google_configured:false,google_script_url:'',google_sheet_url:'',username_login:true,order_revisions:true};let recovered,loseRevisionReply=false;
const base='https://test.supabase.co';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const contexts=[];const errors=[];
 async function device(width=1440){
  const context=await browser.newContext({viewport:{width,height:900}});contexts.push(context);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/backend-config.js*',route=>route.fulfill({contentType:'application/javascript',body:`window.DropTechBackend={enabled:true,url:'${base}',publishableKey:'sb_publishable_test'};`}));
  await page.route(base+'/**',async route=>{
   const req=route.request(),url=new URL(req.url()),body=req.postData()?JSON.parse(req.postData()):{},token=(req.headers().authorization||'').replace('Bearer ',''),account=accounts.find(u=>u.id===token),reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'},body:JSON.stringify(data)});
   if(req.method()==='OPTIONS')return reply({});
   if(url.pathname==='/auth/v1/token'){const a=accounts.find(u=>u.email===body.email);return a&&body.password==='SenhaFicticia123!'?reply({access_token:a.id,refresh_token:a.id,expires_in:3600}):reply({message:'Invalid login credentials'},400);}
   if(url.pathname==='/auth/v1/recover'){recovered={email:body.email,redirect:url.searchParams.get('redirect_to')};return reply({});}
   if(url.pathname==='/functions/v1/droptech-api'&&body.action==='login'){const a=accounts.find(u=>u.username===body.username&&u.active);return a&&body.password==='SenhaFicticia123!'?reply({access_token:a.id,refresh_token:a.id,expires_in:3600}):reply({message:'Usuário ou senha inválidos.'},400);}
   if(url.pathname==='/auth/v1/logout')return reply({});
   if(!account)return reply({message:'Sem sessão'},401);
   if(url.pathname==='/auth/v1/user')return reply({id:account.id});
   if(url.pathname==='/rest/v1/profiles'){const rows=account.role==='admin'?accounts:accounts.filter(u=>u.id===account.id);return reply(url.searchParams.has('id')?rows.filter(u=>'eq.'+u.id===url.searchParams.get('id')):rows);}
   if(!account.active)return reply({message:'Desativado'},403);
   if(url.pathname==='/rest/v1/rpc/workspace_settings')return reply({...settings,google_script_url:account.role==='admin'?settings.google_script_url:'',google_sheet_url:account.role==='admin'?settings.google_sheet_url:''});
   if(url.pathname==='/rest/v1/app_settings'){if(account.role!=='admin')return reply({},403);Object.assign(settings,body);return reply({});}
   if(url.pathname==='/rest/v1/order_revisions'){
    const id=(url.searchParams.get('order_id')||'').replace(/^eq\./,'');
    return reply(revisions.filter(r=>r.order_id===id&&orders.some(o=>o.id===id&&(o.owner_id===account.id||account.role==='admin'))));
   }
   if(url.pathname==='/rest/v1/rpc/revise_order'){
    const o=orders.find(o=>o.id===body.p_order_id&&(o.owner_id===account.id||account.role==='admin'));
    if(!o)return reply({message:'Sem permissão'},403);
    const prior=revisions.find(r=>r.order_id===o.id&&r.request_id===body.p_request_id);
    if(prior)return reply({id:o.id,revision:prior.revision});
    if(o.revision!==body.p_expected_revision)return reply({message:'Este pedido foi revisado em outro aparelho. Atualize os pedidos antes de revisar novamente.',code:'40001'},409);
    o.payload=body.p_payload;o.revision++;o.google_state='not_sent';
    revisions.push({order_id:o.id,revision:o.revision,payload:structuredClone(o.payload),editor_name:account.full_name,edited_at:new Date().toISOString(),reason:body.p_reason,request_id:body.p_request_id});
    if(loseRevisionReply){loseRevisionReply=false;return route.abort('failed');}
    return reply({id:o.id,revision:o.revision});
   }
   if(url.pathname==='/rest/v1/orders'){
    const visible=orders.filter(o=>account.role==='admin'||o.owner_id===account.id),id=(url.searchParams.get('id')||'').replace(/^eq\./,'');
    if(req.method()==='POST'){if(account.role!=='admin'&&body.owner_id!==account.id)return reply({},403);if(!orders.some(o=>o.id===body.id)){orders.push({...body,revision:1,google_state:'not_sent',google_error:''});revisions.push({order_id:body.id,revision:1,payload:structuredClone(body.payload),editor_name:account.full_name,edited_at:new Date().toISOString(),reason:'Pedido criado'});}return reply(null);}
    if(req.method()==='DELETE'){const target=visible.find(o=>o.id===id);if(target)orders.splice(orders.indexOf(target),1);return reply(target?[target]:[]);}
    return reply(id?visible.filter(o=>o.id===id):visible);
   }
   if(url.pathname==='/functions/v1/droptech-api'){
    if(body.action==='create_seller'&&account.role==='admin'){const u={id:'new',email:body.email,username:body.username,full_name:body.name,role:'seller',active:true};accounts.push(u);return reply({message:'Vendedor cadastrado',id:u.id});}
    if(body.action==='set_username'&&account.role==='admin'){const u=accounts.find(u=>u.id===body.id);u.username=body.username.trim().toLowerCase();return reply({message:'Nome de usuário atualizado',username:u.username});}
    if(body.action==='set_seller_active'&&account.role==='admin'){accounts.find(u=>u.id===body.id).active=body.active;return reply({message:'Acesso atualizado'});}
    return reply({message:'Sem permissão'},403);
   }
   return reply({message:'Endpoint não simulado: '+url.pathname},500);
  });
  await page.goto('http://127.0.0.1:4173');return page;
 }
 async function login(page,email){await page.locator('#loginEmail').fill(email);await page.locator('#loginPassword').fill('SenhaFicticia123!');await page.locator('#loginButton').click();await page.locator('#cloudWorkspace').waitFor({state:'visible'});}
 try{
  const pc=await device();await login(pc,'VENDEDOR01');assert.ok(!await pc.locator('#adminPanel').isVisible());assert.ok(!await pc.locator('#googleSettings').isVisible());
  await pc.locator('#clientName').fill('Comprador compartilhado');await pc.locator('#clientCnpj').fill('00.000.000/0001-00');await pc.locator('#buyerName').fill('Pessoa teste');await pc.locator('#buyerPhone').fill('27999999999');await pc.locator('#itemProduct').selectOption({index:1});await pc.locator('#itemMeters').fill('50');await pc.locator('#itemObservation').fill('Cor azul <script>alert(1)</script>');await pc.getByRole('button',{name:'Adicionar item'}).click();await pc.locator('#saveOrderButton').click();await pc.locator('#salesTableBody').getByText('Comprador compartilhado',{exact:true}).waitFor();
  const phone=await device(390);await login(phone,'vendedor01');await phone.locator('#salesTableBody').getByText('Comprador compartilhado',{exact:true}).waitFor();assert.equal(await phone.locator('#salesTableBody tr').count(),1);
  const sellerB=await device(320);await login(sellerB,'vendedor02');assert.ok(!(await sellerB.locator('#salesTableBody').innerText()).includes('Comprador compartilhado'));
  const admin=await device(390);await login(admin,'admin@example.test');await admin.locator('#usersList').getByText('Vendedor A',{exact:false}).waitFor();assert.match(await admin.locator('#salesTableBody').innerText(),/Vendedor A/);
  const original=structuredClone(orders[0]);assert.equal(original.payload.items[0].observation,'Cor azul <script>alert(1)</script>');
  await pc.getByRole('button',{name:'Revisar',exact:true}).click();
  await phone.getByRole('button',{name:'Revisar',exact:true}).click();await phone.getByRole('button',{name:'Editar item 1',exact:true}).click();assert.equal(await phone.locator('#itemObservation').inputValue(),original.payload.items[0].observation);
  await phone.locator('#itemObservation').fill('Cor verde, sem emendas');await phone.locator('#itemMeters').fill('60');await phone.locator('#addItemButton').click();await phone.locator('#revisionReason').fill('Cliente solicitou verde e mais metragem');
  loseRevisionReply=true;await phone.locator('#saveOrderButton').click();await phone.locator('#orderSaveStatus').getByText(/Não foi possível salvar a revisão/).waitFor();assert.equal(revisions.length,2);
  await phone.locator('#saveOrderButton').click();await phone.locator('#orderSaveStatus').getByText(/Revisão salva/).waitFor();assert.equal(revisions.length,2);assert.equal(orders[0].revision,2);assert.equal(orders[0].id,original.id);assert.equal(orders[0].payload.date,original.payload.date);
  await pc.locator('#clientName').fill('Conflito de edição');await pc.locator('#revisionReason').fill('Outra edição simultânea');await pc.locator('#saveOrderButton').click();await pc.locator('#orderSaveStatus').getByText(/outro aparelho/).waitFor();assert.equal(orders[0].revision,2);await pc.getByRole('button',{name:'Cancelar',exact:true}).click();await pc.locator('#refreshOrders').click();
  await phone.getByRole('button',{name:'Versões',exact:true}).click();await phone.locator('.revision-card').first().waitFor();assert.equal(await phone.locator('.revision-card').count(),2);assert.match(await phone.locator('#revisionHistoryList').innerText(),/Vendedor A/);assert.match(await phone.locator('#revisionHistoryList').innerText(),/Cor verde/);
  if(process.env.SCREENSHOT_DIR)await phone.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'revisoes-mobile.png'),fullPage:true});
  await phone.locator('.revision-card').last().getByRole('button',{name:'Ver / PDF desta versão'}).click();assert.match(await phone.locator('#printOrder').innerText(),/Cor azul/);assert.ok(!(await phone.locator('#printOrder').innerText()).includes('Cor verde'));const oldPdf=phone.waitForEvent('download');await phone.locator('#savePdfButton').click();assert.match((await oldPdf).suggestedFilename(),/-v1.pdf$/);await phone.locator('#orderPreview').getByRole('button',{name:'Fechar',exact:true}).click();
  await phone.evaluate(()=>document.querySelector('#itemProduct option:nth-child(2)').setAttribute('data-price','9.99'));
  await phone.getByRole('button',{name:'Renovar',exact:true}).click();assert.equal(await phone.locator('#revisionReasonField').isVisible(),false);assert.match(await phone.locator('#cartTableBody').innerText(),/Cor verde/);assert.match(await phone.locator('#cartTableBody').innerText(),/9,9900/);
  if(process.env.SCREENSHOT_DIR)await phone.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'renovacao-mobile.png'),fullPage:true});
  await phone.locator('#saveOrderButton').click();await phone.locator('#orderSaveStatus').getByText(/Pedido salvo no banco/).waitFor();assert.equal(orders.length,2);assert.notEqual(orders[1].id,original.id);assert.equal(orders[1].payload.renewedFromId,original.id);assert.equal(orders[1].payload.items[0].unitPrice,9.99);assert.equal(orders[1].revision,1);assert.equal(orders[0].revision,2);assert.equal(orders[0].payload.items[0].unitPrice,original.payload.items[0].unitPrice);
  await sellerB.locator('#refreshOrders').click();assert.equal(await sellerB.locator('#salesTableBody tr').count(),1);assert.ok(!(await sellerB.locator('#salesTableBody').innerText()).includes('Comprador compartilhado'));
  for(const p of [pc,phone,sellerB,admin])assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Cloud page overflow');
  const downloadPromise=phone.waitForEvent('download');await phone.getByRole('button',{name:'Ver / PDF',exact:true}).first().click();await phone.locator('#savePdfButton').click();assert.match((await downloadPromise).suggestedFilename(),/\.pdf$/);await phone.getByRole('button',{name:'Fechar',exact:true}).click();
  await admin.getByText('Cadastrar vendedor',{exact:true}).first().click();await admin.locator('#sellerName').fill('Vendedor C');await admin.locator('#sellerUsername').fill('vendedor03');await admin.locator('#sellerEmail').fill('c@example.test');await admin.locator('#sellerPassword').fill('1234');assert.equal(await admin.locator('#sellerPassword').evaluate(el=>el.checkValidity()),false);await admin.locator('#sellerPassword').fill('123456');await admin.locator('#createSellerButton').click();await admin.locator('#usersList').getByText('Vendedor C',{exact:false}).waitFor();
  const rowB=admin.locator('.user-row').filter({hasText:'Vendedor B'});await rowB.locator('input').fill('vendedor04');await rowB.getByRole('button',{name:'Salvar usuário'}).click();await admin.locator('#adminStatus').getByText('Nome de usuário atualizado',{exact:true}).waitFor();
  await admin.setViewportSize({width:320,height:900});assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Admin username form overflow at 320px');await admin.setViewportSize({width:390,height:900});
  if(process.env.SCREENSHOT_DIR){await admin.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'admin-mobile.png'),fullPage:true});}
  await admin.locator('.user-row').filter({hasText:'Vendedor A'}).getByRole('button',{name:'Desativar'}).click();await admin.locator('#adminStatus').getByText('Acesso atualizado',{exact:true}).waitFor();
  await phone.locator('#refreshOrders').click();await phone.locator('#authGate').waitFor({state:'visible'});assert.ok(!await phone.locator('#cloudWorkspace').isVisible());assert.ok(!(await phone.locator('#salesTableBody').innerText()).includes('Comprador compartilhado'));
  await sellerB.locator('#logoutButton').click();await sellerB.locator('#authGate').waitFor({state:'visible'});await sellerB.reload();await sellerB.locator('#loginForm').waitFor({state:'visible'});assert.ok(!await sellerB.locator('#cloudWorkspace').isVisible());assert.equal(await sellerB.locator('#loginEmail').inputValue(),'vendedor02');assert.equal(await sellerB.locator('#loginPassword').inputValue(),'');
  await sellerB.locator('#loginPassword').fill('SenhaErrada');await sellerB.locator('#loginButton').click();await sellerB.locator('#authStatus').getByText('Usuário ou senha inválidos.',{exact:true}).waitFor();assert.equal(await sellerB.locator('#loginPassword').inputValue(),'');
  await sellerB.locator('#recoverButton').click();await sellerB.locator('#recoveryEmail').fill('b@example.test');await sellerB.locator('#sendRecoveryButton').click();await sellerB.locator('#authStatus').getByText(/Solicitação enviada/).waitFor();assert.equal(recovered.email,'b@example.test');assert.equal(recovered.redirect,'http://127.0.0.1:4173/');
  await sellerB.locator('#cancelRecovery').click();await sellerB.locator('#rememberLogin').uncheck();await login(sellerB,'vendedor04');await sellerB.locator('#logoutButton').click();await sellerB.reload();await sellerB.locator('#loginForm').waitFor({state:'visible'});assert.equal(await sellerB.locator('#loginEmail').inputValue(),'');
  if(process.env.SCREENSHOT_DIR)await sellerB.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'login-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: usuário/e-mail, lembrar e esquecer usuário, recuperação, senha 6, PC/celular, isolamento, admin, cadastro/desativação, PDF e mobile (API simulada).');
 }finally{for(const context of contexts)await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

const test=require('node:test');const assert=require('node:assert/strict');
const {create}=require('../cloud-store.js');const googleContext=require('./google-mock.cjs');
const config={url:'https://test.supabase.co',publishableKey:'sb_publishable_test'};
const storage=()=>{const data=new Map();return{data,getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
const response=(body,status=200)=>({ok:status<400,status,text:async()=>JSON.stringify(body)});
const order={id:'test',date:'06/10/2026 10:00',client:'Cliente',cnpj:'000',ie:'Isento',buyer:'Teste',phone:'27999',payment:'Pix à Vista',items:[{product:'Mangueira',detail:'50m',meters:50,unitPrice:2,subtotal:100}],gross:100,discountPct:0,discountVal:0,final:100};
test('Auth só carrega perfil ativo e não usa metadata para papel; logout limpa sessão',async()=>{
 const local=storage();let userCalls=0;
 const store=create(config,{storage:local,fetch:async(url,options)=>{
  if(url.includes('/token?'))return response({access_token:'token',refresh_token:'refresh',expires_in:3600,user:{id:'seller',user_metadata:{role:'admin'}}});
  assert.equal(options.headers.Authorization,'Bearer token');
  if(url.endsWith('/user')){userCalls++;return response({id:'seller'});}
  if(url.includes('/profiles?'))return response([{id:'seller',role:'seller',active:true}]);
  return response(null);
 }});
 assert.equal((await store.signIn('teste@example.test','pass')).role,'seller');
 assert.equal((await store.restore()).id,'seller');assert.equal(userCalls,2);
 await store.signOut();assert.equal(local.data.size,0);assert.equal(store.currentProfile(),null);
});
test('Conta desativada não retém sessão; falha de rede não vira uma lista vazia nem grava pedidos locais',async()=>{
 const local=storage();let active=false;
 const store=create(config,{storage:local,fetch:async(url)=>{
  if(url.includes('/token?'))return response({access_token:'token',refresh_token:'refresh',expires_in:3600});
  if(url.endsWith('/user'))return response({id:'seller'});
  if(url.includes('/profiles?'))return response([{id:'seller',role:'seller',active}]);
  throw new Error('sem internet');
 }});
 await assert.rejects(()=>store.signIn('teste@example.test','pass'),/Acesso não liberado/);assert.equal(local.data.size,0);
 active=true;await store.signIn('teste@example.test','pass');await assert.rejects(()=>store.listOrders(),/sem internet/);
 assert.ok(!local.data.has('droptech_sales_v3'));
});
test('Renovação simultânea reutiliza uma requisição; nunca volta a autenticar após sair durante refresh',async()=>{
 const local=storage();let clock=100000,refreshes=0,release;
 const store=create(config,{storage:local,now:()=>clock,fetch:async(url)=>{
  if(url.includes('grant_type=password'))return response({access_token:'token',refresh_token:'refresh',expires_in:3600});
  if(url.includes('grant_type=refresh_token')){refreshes++;await new Promise(r=>release=r);return response({access_token:'new',refresh_token:'new-refresh',expires_in:3600});}
  if(url.endsWith('/user'))return response({id:'seller'});
  if(url.includes('/profiles?'))return response([{id:'seller',role:'seller',active:true}]);
  return response([]);
 }});
 await store.signIn('test','pass');clock+=3600000;
 const first=store.listOrders(),second=store.listOrders();await new Promise(r=>setImmediate(r));assert.equal(refreshes,1);release();await Promise.all([first,second]);
 clock+=3600000;const pending=store.listOrders();await new Promise(r=>setImmediate(r));await store.signOut();release();await assert.rejects(()=>pending,/encerrada/);assert.equal(local.data.size,0);
});
test('Pedidos vêm paginados, salvamento é idempotente, conflito não substitui outro proprietário',async()=>{
 const local=storage();let page=0,posted,collision=false;
 const store=create(config,{storage:local,fetch:async(url,options)=>{
  if(url.includes('/token?'))return response({access_token:'token',refresh_token:'refresh',expires_in:3600});
  if(url.endsWith('/user'))return response({id:'seller'});
  if(url.includes('/profiles?'))return response([{id:'seller',role:'seller',active:true}]);
  if(options.method==='POST'){posted=JSON.parse(options.body);assert.equal(options.headers.Prefer,'resolution=ignore-duplicates');return response(null);}
  if(url.includes('id=eq.'))return response([{owner_id:collision?'other':'seller',payload:{...order}}]);
  return response(page++===0?Array.from({length:500},(_,i)=>({id:'o'+i,owner_id:'seller',payload:{...order,id:'o'+i}})):[]);
 }});
 await store.signIn('test','pass');assert.equal((await store.listOrders()).length,500);assert.equal(page,2);
 await store.saveOrder(order);assert.equal(posted.owner_id,'seller');collision=true;await assert.rejects(()=>store.saveOrder(order),/Conflito/);
 await assert.rejects(()=>store.importOrders([order],'other'),/Somente o administrador/);
});
test('Chaves administrativas são rejeitadas no frontend',()=>{
 assert.throws(()=>create({...config,publishableKey:'sb_secret_private'}),/pública/);
 const token='eyJ.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64')+'.x';assert.throws(()=>create({...config,publishableKey:token}),/Nunca use service_role/);
});
test('Apps Script em modo servidor exige token e fecha o acesso legado à planilha',()=>{
 const mock=googleContext();const token='a'.repeat(64);mock.properties.set('DROPTECH_SERVER_TOKEN',token);
 for(const body of [{},{serverToken:'wrong',payload:{version:1,orders:[order]}}]){
  const result=JSON.parse(mock.context.doPost({postData:{contents:JSON.stringify(body)}}).text);assert.equal(result.ok,false);assert.equal(mock.created,0);
 }
 assert.equal(mock.context.syncOrders({version:1,orders:[order]}).ok,false);
 assert.throws(()=>mock.context.getConnectionInfo(),/somente no sistema/);
 assert.ok(!mock.context.doGet({parameter:{bridge:'2',nonce:'test',origin:'https://test'}}).html.includes('script.google.run'));
 const payload={serverToken:token,payload:{version:1,orders:[order]}};
 const result=JSON.parse(mock.context.doPost({postData:{contents:JSON.stringify(payload)}}).text);assert.equal(result.ok,true);assert.equal(mock.created,1);
 const again=JSON.parse(mock.context.doPost({postData:{contents:JSON.stringify(payload)}}).text);assert.equal(again.ok,true);assert.equal(mock.created,1);
 assert.ok(!JSON.stringify(result).includes(token));
});

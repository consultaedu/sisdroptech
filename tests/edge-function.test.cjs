const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {stripTypeScriptTypes}=require('node:module');
function harness(){
 const profiles=[{id:'admin',role:'admin',active:true},{id:'a',role:'seller',active:true},{id:'b',role:'seller',active:true},{id:'off',role:'seller',active:false}];
 const records=[{id:'own',owner_id:'a',payload:{id:'own',client:'Do banco'}},{id:'foreign',owner_id:'b',payload:{id:'foreign',client:'Outro vendedor'}}];
 const updates=[];let exported,handler;
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private',SUPABASE_ANON_KEY:'public',APP_ORIGINS:'https://app.test',GOOGLE_SYNC_TOKEN:'server-secret'};
 function client(_url,_key,options){const token=options?.global?.headers?.Authorization?.replace('Bearer ','');return {
  auth:{getUser:async token=>({data:{user:profiles.some(p=>p.id===token)?{id:token}:null},error:profiles.some(p=>p.id===token)?null:{message:'Invalid'}}),admin:{createUser:async()=>{throw new Error('Creation not expected');}}},
  from(table){let filters=[],update,select=false;const query={eq(k,v){filters.push([k,v]);return query;},in(k,v){filters.push([k,v]);return query;},select(){select=true;return query;},update(value){update=value;return query;},single:async()=>resolve(true),then(onSuccess,onError){return Promise.resolve(resolve(false)).then(onSuccess,onError);}};
   function resolve(single){
    let rows=table==='profiles'?profiles:table==='orders'?records:[{id:true,google_script_url:'https://script.google.com/macros/s/test/exec'}];
    if(token&&table==='orders')rows=rows.filter(r=>r.owner_id===token||token==='admin');
    rows=rows.filter(row=>filters.every(([k,v])=>Array.isArray(v)?v.includes(row[k]):row[k]===v));
    if(update){updates.push({table,rows:rows.map(r=>r.id),update});for(const row of rows)Object.assign(row,update);}
    return {data:single?rows[0]:rows,error:single&&!rows.length?{message:'Not found'}:null};
   }return query;
  }
 };}
 let source=fs.readFileSync(path.join(__dirname,'../supabase/functions/droptech-api/index.ts'),'utf8').replace(/^import .*;\s*/,'');
 source=stripTypeScriptTypes(source);
 vm.runInNewContext(source,{Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},createClient:client,Request,Response,AbortSignal,crypto:require('node:crypto').webcrypto,fetch:async(url,options)=>{exported=JSON.parse(options.body);return new Response(JSON.stringify({ok:true,orderIds:['own'],spreadsheetUrl:'https://docs.google.com/spreadsheets/d/test/edit'}),{status:200});}});
 return {profiles,updates,get exported(){return exported;},call:async(token,body,origin='https://app.test')=>{const response=await handler(new Request('https://test',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}));return{status:response.status,data:await response.json().catch(()=>null)};}};
}
test('Função exige sessão ativa/admin e impede ao vendedor exportar pedidos de outra pessoa',async()=>{
 const h=harness();assert.equal((await h.call('invalid',{action:'sync_google',ids:['own']})).status,401);
 assert.equal((await h.call('off',{action:'sync_google',ids:['own']})).status,403);
 assert.equal((await h.call('a',{action:'create_seller',email:'x@x.test',name:'X',password:'longpassword'})).status,403);
 assert.equal((await h.call('a',{action:'set_seller_active',id:'b',active:false})).status,403);
 assert.equal((await h.call('a',{action:'sync_google',ids:['foreign']})).status,403);
 assert.equal((await h.call('admin',{action:'set_seller_active',id:'admin',active:false})).status,400);
 assert.equal((await h.call('a',{action:'sync_google',ids:['own']},'https://evil.test')).status,403);
 assert.equal(h.exported,undefined);
});
test('Envio usa dados do banco, nunca payload do navegador, e só admin recebe o link geral',async()=>{
 const h=harness();const result=await h.call('a',{action:'sync_google',ids:['own'],orders:[{id:'own',client:'Adulterado'}]});
 assert.equal(result.status,200);assert.equal(result.data.spreadsheetUrl,undefined);
 assert.equal(h.exported.payload.orders[0].client,'Do banco');assert.equal(h.exported.serverToken,'server-secret');
 assert.ok(!JSON.stringify(result.data).includes('server-secret'));
 assert.ok(h.updates.some(u=>u.table==='orders'&&u.rows.join()==='own'&&u.update.google_state==='sent'));
 const admin=await h.call('admin',{action:'sync_google',ids:['own']});assert.equal(admin.status,200);assert.match(admin.data.spreadsheetUrl,/docs.google.com/);
});

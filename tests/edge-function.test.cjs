const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {stripTypeScriptTypes}=require('node:module');
function harness(){
 const profiles=[{id:'admin',role:'admin',active:true},{id:'a',role:'seller',active:true},{id:'b',role:'seller',active:true},{id:'off',role:'seller',active:false}].map(p=>({...p,email:p.id+'@example.test',username:p.id==='a'?'vendedor01':'user_'+p.id}));
 const records=[{id:'own',owner_id:'a',payload:{id:'own',client:'Do banco'}},{id:'foreign',owner_id:'b',payload:{id:'foreign',client:'Outro vendedor'}}];
 const updates=[];let exported,handler,created,authCalls=0,limited=false,wrongSession=false;
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private',SUPABASE_ANON_KEY:'public',APP_ORIGINS:'https://app.test',GOOGLE_SYNC_TOKEN:'server-secret'};
 function client(_url,_key,options){const token=options?.global?.headers?.Authorization?.replace('Bearer ','');return {
  rpc:async()=>({data:!limited,error:null}),
  auth:{signInWithPassword:async({email,password})=>{authCalls++;const p=profiles.find(p=>p.email===email);return password==='123456'&&p?{data:{user:{id:p.id},session:{user:{id:wrongSession?'b':p.id},access_token:'valid-token',refresh_token:'valid-refresh',expires_in:3600,token_type:'bearer'}},error:null}:{data:{},error:{status:400}};},
   getUser:async token=>({data:{user:profiles.some(p=>p.id===token)?{id:token}:null},error:profiles.some(p=>p.id===token)?null:{message:'Invalid'}}),
   admin:{createUser:async details=>{created=details;profiles.push({id:'new',email:details.email,username:details.user_metadata.username,role:'seller',active:false});return{data:{user:{id:'new'}},error:null};}}},
  from(table){let filters=[],update,select=false;const query={eq(k,v){filters.push([k,v]);return query;},in(k,v){filters.push([k,v]);return query;},select(){select=true;return query;},update(value){update=value;return query;},single:async()=>resolve(true),maybeSingle:async()=>resolve(true,true),then(onSuccess,onError){return Promise.resolve(resolve(false)).then(onSuccess,onError);}};
   function resolve(single,optional=false){
    let rows=table==='profiles'?profiles:table==='orders'?records:[{id:true,google_script_url:'https://script.google.com/macros/s/test/exec'}];
    if(token&&table==='orders')rows=rows.filter(r=>r.owner_id===token||token==='admin');
    rows=rows.filter(row=>filters.every(([k,v])=>Array.isArray(v)?v.includes(row[k]):row[k]===v));
    if(update?.username&&profiles.some(p=>p.username===update.username&&!rows.includes(p)))return {data:null,error:{code:'23505'}};
    if(update){updates.push({table,rows:rows.map(r=>r.id),update});for(const row of rows)Object.assign(row,update);}
    return {data:single?rows[0]:rows,error:single&&!optional&&!rows.length?{message:'Not found'}:null};
   }return query;
  }
 };}
 let source=fs.readFileSync(path.join(__dirname,'../supabase/functions/droptech-api/index.ts'),'utf8').replace(/^import .*;\s*/,'');
 source=stripTypeScriptTypes(source);
 vm.runInNewContext(source,{Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},createClient:client,Request,Response,AbortSignal,crypto:require('node:crypto').webcrypto,fetch:async(url,options)=>{exported=JSON.parse(options.body);return new Response(JSON.stringify({ok:true,orderIds:['own'],spreadsheetUrl:'https://docs.google.com/spreadsheets/d/test/edit'}),{status:200});}});
 return {profiles,updates,get exported(){return exported;},get created(){return created;},get authCalls(){return authCalls;},set limited(value){limited=value;},set wrongSession(value){wrongSession=value;},call:async(token,body,origin='https://app.test')=>{const response=await handler(new Request('https://test',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}));return{status:response.status,data:await response.json().catch(()=>null)};}};
}

test('Login por usuário só devolve sessão após senha válida; falhas não revelam e-mail, conta inativa ou sessão de outra conta',async()=>{
 const h=harness();
 const call=(username,password='123456')=>h.call('',{action:'login',username,password});
 const wrong=await call('vendedor01','errada'),missing=await call('inexistente'),inactive=await call('user_off');
 assert.equal(wrong.status,400);assert.deepEqual(wrong,missing);assert.deepEqual(missing,inactive);assert.equal(h.authCalls,1);
 const good=await call(' VENDEDOR01 ');assert.equal(good.status,200);assert.equal(good.data.access_token,'valid-token');assert.ok(!JSON.stringify(good.data).includes('@'));
 h.wrongSession=true;assert.equal((await call('vendedor01')).status,400);h.wrongSession=false;
 h.limited=true;const calls=h.authCalls;assert.equal((await call('vendedor01')).status,429);assert.equal(h.authCalls,calls);
 assert.equal((await h.call('',{action:'set_username',id:'a',username:'outro'})).status,401);
 assert.equal((await h.call('',{action:'login',username:'vendedor01',password:'123456'},'https://evil.test')).status,403);
 assert.equal((await h.call('',null)).status,400);
});
test('Só admin altera usuário; duplicado não sobrescreve outra conta; novo vendedor admite senha de 6 caracteres',async()=>{
 const h=harness();
 assert.equal((await h.call('a',{action:'set_username',id:'a',username:'outro'})).status,403);
 assert.equal((await h.call('admin',{action:'set_username',id:'b',username:'vendedor01'})).status,400);
 assert.equal(h.profiles.find(p=>p.id==='b').username,'user_b');
 const updated=await h.call('admin',{action:'set_username',id:'b',username:' VENDEDOR02 '});assert.equal(updated.data.username,'vendedor02');
 assert.equal((await h.call('admin',{action:'set_username',id:'missing',username:'vendedor03'})).status,404);
 const details={action:'create_seller',name:'Vendedor novo',email:'new@example.test',username:'VENDEDOR03'};
 assert.equal((await h.call('admin',{...details,password:'1234'})).status,400);
 assert.equal((await h.call('admin',{...details,username:'vendedor01',password:'123456'})).status,400);
 assert.equal((await h.call('admin',{...details,password:'123456'})).status,200);
 assert.equal(h.created.user_metadata.username,'vendedor03');assert.equal(h.created.password,'123456');
 assert.equal(h.profiles.find(p=>p.id==='new').active,true);
});
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

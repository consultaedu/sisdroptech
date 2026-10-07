const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
// Install @electric-sql/pglite externally and set PGLITE_MODULE, or use a local dev dependency.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const ids={admin:'00000000-0000-0000-0000-000000000001',a:'00000000-0000-0000-0000-000000000002',b:'00000000-0000-0000-0000-000000000003',off:'00000000-0000-0000-0000-000000000004'};
const order=id=>({id,date:'06/10/2026 10:00',client:'Cliente teste',cnpj:'00.000.000/0001-00',ie:'Isento',buyer:'Pessoa teste',phone:'27999999999',payment:'Pix à Vista',items:[{product:'Mangueira',detail:'50m',meters:50,unitPrice:2,subtotal:100}],gross:100,discountPct:10,discountVal:10,final:90});
test('Migração de usuários preserva contas e pedidos, resolve nomes repetidos e limita tentativas somente no servidor',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
  const migrations=path.join(__dirname,'../supabase/migrations');
  for(const file of fs.readdirSync(migrations).filter(name=>name.endsWith('.sql')&&!name.includes('usernames')).sort())await db.exec(fs.readFileSync(path.join(migrations,file),'utf8'));
  for(const [id,email] of [[ids.admin,'Vendedor@example.test'],[ids.a,'vendedor@other.test'],[ids.b,'x@example.test']])await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,email,{full_name:'Original',role:'admin',active:true}]);
  await db.query("update public.profiles set role='admin',active=true where id=$1",[ids.admin]);
  await db.query('insert into public.orders(id,owner_id,payload) values($1,$2,$3)',['old',ids.admin,order('old')]);
  const before=(await db.query('select id,email,role,active,full_name,created_at from public.profiles order by id')).rows;
  const oldOrders=(await db.query('select * from public.orders')).rows;
  await db.exec(fs.readFileSync(path.join(migrations,'202610070001_usernames.sql'),'utf8'));
  assert.deepEqual((await db.query('select id,email,role,active,full_name,created_at from public.profiles order by id')).rows,before);
  assert.deepEqual((await db.query('select * from public.orders')).rows,oldOrders);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='private.username_login_attempts'::regclass")).rows[0].relrowsecurity,true);
  await db.exec(fs.readFileSync(path.join(migrations,'202610070002_usernames_rls.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(migrations,'202610070002_usernames_rls.sql'),'utf8'));
  assert.deepEqual((await db.query('select username from public.profiles order by id')).rows.map(r=>r.username),['vendedor','vendedor_2','usuario_x']);
  await assert.rejects(()=>db.query("update public.profiles set username='vendedor' where id=$1",[ids.a]),/unique constraint/);
  await assert.rejects(()=>db.query("update public.profiles set username='VENDEDOR' where id=$1",[ids.a]),/check constraint/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.admin]);await db.exec('set role authenticated');
  assert.equal((await db.query('select public.workspace_settings() as settings')).rows[0].settings.username_login,true);
  await assert.rejects(()=>db.query("update public.profiles set username='outro' where id=$1",[ids.admin]),/permission denied/);
  await assert.rejects(()=>db.query('select public.reserve_username_login($1)',[ids.admin]),/permission denied/);
  await db.exec('reset role');await db.exec('set role anon');
  await assert.rejects(()=>db.query('select public.reserve_username_login($1)',[ids.admin]),/permission denied/);
  await db.exec('reset role');await db.exec('set role service_role');
  for(let i=0;i<10;i++)assert.equal((await db.query('select public.reserve_username_login($1) as allowed',[ids.admin])).rows[0].allowed,true);
  assert.equal((await db.query('select public.reserve_username_login($1) as allowed',[ids.admin])).rows[0].allowed,false);
  await db.exec('reset role');
  // RLS continues denying browser roles even if table privileges are granted accidentally.
  await db.exec('grant usage on schema private to authenticated,anon; grant select,insert on private.username_login_attempts to authenticated,anon');
  for(const role of ['authenticated','anon']){await db.exec('set role '+role);assert.equal((await db.query('select * from private.username_login_attempts')).rows.length,0);await assert.rejects(()=>db.query('insert into private.username_login_attempts values($1,now(),1)',[ids.a]),/row-level security/);await db.exec('reset role');}
  await db.exec("update private.username_login_attempts set window_start=now()-interval '2 minutes'");
  await db.exec('set role service_role');assert.equal((await db.query('select public.reserve_username_login($1) as allowed',[ids.admin])).rows[0].allowed,true);
  await db.exec('reset role');await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[ids.off,'new@example.test',{username:'VENDEDOR01',role:'admin',active:true}]);
  const newAccount=(await db.query('select username,role,active from public.profiles where id=$1',[ids.off])).rows[0];
  assert.deepEqual(newAccount,{username:'vendedor01',role:'seller',active:false});
 }finally{await db.close();}
});
test('PostgreSQL real: RLS separa vendedores, bloqueia promoção, acesso anônimo e conta inativa; admin vê tudo',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
  const migrations=path.join(__dirname,'../supabase/migrations');
  for(const file of fs.readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(migrations,file),'utf8'));
  for(const id of Object.values(ids))await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,id+'@example.test',{role:'admin',active:true,full_name:'Teste'}]);
  const initial=await db.query('select role,active from public.profiles');
  assert.ok(initial.rows.every(r=>r.role==='seller'&&!r.active),'Metadata cannot promote or activate a user');
  await db.query("update public.profiles set active=true where id<>$1",[ids.off]);
  await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
  const as=async(role,id)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+role);};
  const insert=async(id,owner,p=order(id))=>db.query('insert into public.orders(id,owner_id,payload) values($1,$2,$3)',[id,owner,p]);
  await as('authenticated',ids.a);await insert('a',ids.a);
  await assert.rejects(()=>insert('spoof',ids.b),/row-level security/);
  await assert.rejects(()=>db.query("update public.profiles set role='admin' where id=$1",[ids.a]),/permission denied/);
  await assert.rejects(()=>db.exec('update public.orders set owner_id=owner_id'),/permission denied/);
  await assert.rejects(()=>insert('invalid',ids.a,{...order('invalid'),final:0}),/check constraint/);
  await assert.rejects(()=>insert('null',ids.a,{...order('null'),client:null}),/check constraint/);
  await as('authenticated',ids.b);await insert('b',ids.b);
  assert.deepEqual((await db.query('select id from public.orders')).rows.map(r=>r.id),['b']);
  assert.equal((await db.query("delete from public.orders where id='a' returning id")).rows.length,0);
  assert.equal((await db.query('select * from public.app_settings')).rows.length,0);
  const sellerSettings=(await db.query('select public.workspace_settings() as settings')).rows[0].settings;
  assert.equal(sellerSettings.google_script_url,'');assert.equal(sellerSettings.google_sheet_url,'');
  await as('authenticated',ids.admin);
  assert.equal((await db.query('select * from public.orders')).rows.length,2);
  await insert('legacy',ids.a); // Admin can assign imported orders to a seller.
  await db.exec("update public.app_settings set environment='Oficial',google_script_url='https://script.google.com/macros/s/test/exec'");
  assert.equal((await db.query('select public.workspace_settings() as settings')).rows[0].settings.environment,'Oficial');
  await as('authenticated',ids.off);
  assert.equal((await db.query('select * from public.orders')).rows.length,0);
  await assert.rejects(()=>insert('off',ids.off),/row-level security/);
  await assert.rejects(()=>db.query('select public.workspace_settings()'),/Acesso não liberado/);
  await as('anon');await assert.rejects(()=>db.query('select * from public.orders'),/permission denied/);
  await as('authenticated',ids.a);assert.deepEqual((await db.query('select id from public.orders order by id')).rows.map(r=>r.id),['a','legacy']);
  await as('service_role');await db.exec("update public.orders set google_state='sent' where id='a'");
  await as('authenticated',ids.a);assert.equal((await db.query("select google_state from public.orders where id='a'")).rows[0].google_state,'sent');
  await db.exec('reset role');await db.query('update public.profiles set active=false where id=$1',[ids.a]);
  await as('authenticated',ids.a);assert.equal((await db.query('select * from public.orders')).rows.length,0);
 }finally{await db.close();}
});

test('Trocar destino Google redefine só estados necessários; mudar nome mantém confirmação e dados dos pedidos',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
  const migrations=path.join(__dirname,'../supabase/migrations');
  for(const file of fs.readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(migrations,file),'utf8'));
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[ids.admin,'admin@example.test',{}]);
  await db.query("update public.profiles set role='admin',active=true where id=$1",[ids.admin]);
  for(const id of ['sent','failed','pending'])await db.query('insert into public.orders(id,owner_id,payload) values($1,$2,$3)',[id,ids.admin,order(id)]);
  await db.exec("update public.orders set google_state='sent' where id='sent'; update public.orders set google_state='error',google_error='Sem confirmação' where id='failed';");
  const before=(await db.query('select id,owner_id,payload,created_at,ctid::text as tuple from public.orders order by id')).rows;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.admin]);await db.exec('set role authenticated');
  await db.query("update public.app_settings set google_script_url=$1,environment=$2 where id=true",['https://script.google.com/macros/s/first/exec','Teste']);
  const reset=(await db.query('select id,google_state,google_error from public.orders order by id')).rows;
  assert.ok(reset.every(row=>row.google_state==='not_sent'&&row.google_error===''));
  await db.exec('reset role');
  const after=(await db.query('select id,owner_id,payload,created_at,ctid::text as tuple from public.orders order by id')).rows;
  for(const row of before){const current=after.find(next=>next.id===row.id);assert.deepEqual(current.payload,row.payload);assert.equal(current.owner_id,row.owner_id);assert.deepEqual(current.created_at,row.created_at);}
  assert.equal(after.find(row=>row.id==='pending').tuple,before.find(row=>row.id==='pending').tuple,'A row already not_sent is not rewritten');
  await db.exec("update public.orders set google_state='sent' where id='sent'; update public.app_settings set google_sheet_url='https://docs.google.com/spreadsheets/d/test/edit' where id=true;");
  await db.exec('set role authenticated');
  await db.query('update public.app_settings set environment=$1,google_auto_send=false where id=true',['Nome atualizado']);
  assert.equal((await db.query("select google_state from public.orders where id='sent'")).rows[0].google_state,'sent');
  assert.equal((await db.query('select public.workspace_settings() as data')).rows[0].data.google_sheet_url,'https://docs.google.com/spreadsheets/d/test/edit');
  await db.query('update public.app_settings set google_script_url=$1 where id=true',['https://script.google.com/macros/s/second/exec']);
  assert.equal((await db.query("select google_state from public.orders where id='sent'")).rows[0].google_state,'not_sent');
  assert.equal((await db.query('select public.workspace_settings() as data')).rows[0].data.google_sheet_url,'');
 }finally{await db.close();}
});

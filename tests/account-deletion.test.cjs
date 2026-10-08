const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const ids={admin:'00000000-0000-0000-0000-000000000001',empty:'00000000-0000-0000-0000-000000000002',orders:'00000000-0000-0000-0000-000000000003',otherAdmin:'00000000-0000-0000-0000-000000000004'};
test('Exclusão Auth remove conta vazia e perfil, preserva pedidos e bloqueia o último administrador ativo',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
   create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated,supabase_auth_admin;
   grant execute on function auth.uid() to authenticated;
   grant select,delete on auth.users to supabase_auth_admin;`);
  const migrations=path.join(__dirname,'../supabase/migrations');
  for(const file of fs.readdirSync(migrations).filter(name=>name.endsWith('.sql')&&!name.includes('account_deletion')).sort())await db.exec(fs.readFileSync(path.join(migrations,file),'utf8'));
  for(const [name,id] of Object.entries(ids))await db.query('insert into auth.users values($1,$2,$3)',[id,name+'@example.test',{}]);
  await db.exec("update public.profiles set active=true");
  await db.query("update public.profiles set role='admin' where id=any($1::uuid[])",[[ids.admin,ids.otherAdmin]]);
  const payload={id:'history',date:'07/10/2026',client:'Cliente',cnpj:'00',ie:'Isento',buyer:'Pessoa',phone:'27',payment:'Pix',items:[{product:'Mangueira',detail:'50m',meters:50,unitPrice:2,subtotal:100}],gross:100,discountPct:0,discountVal:0,final:100};
  await db.query('insert into public.orders(id,owner_id,payload) values($1,$2,$3)',['history',ids.orders,payload]);
  for(const id of [ids.empty,ids.orders])await db.query('select public.reserve_username_login($1)',[id]);
  const originalOrders=(await db.query('select * from public.orders')).rows;
  const originalProfiles=(await db.query('select * from public.profiles order by id')).rows;
  await assert.rejects(()=>db.query('delete from auth.users where id=$1',[ids.empty]),/foreign key constraint/);
  await db.exec(fs.readFileSync(path.join(migrations,'202610070003_account_deletion.sql'),'utf8'));
  assert.deepEqual((await db.query('select * from public.profiles order by id')).rows,originalProfiles);
  assert.deepEqual((await db.query('select * from public.orders')).rows,originalOrders);

  // Simulate the restricted role used by Auth, rather than deleting as PostgreSQL owner.
  await db.exec('set role supabase_auth_admin');
  await db.query('delete from auth.users where id=$1',[ids.empty]);
  await db.exec('reset role');
  for(const table of ['auth.users','public.profiles'])assert.equal((await db.query('select id from '+table+' where id=$1',[ids.empty])).rows.length,0);
  assert.equal((await db.query('select * from private.username_login_attempts where profile_id=$1',[ids.empty])).rows.length,0);

  await db.exec('set role supabase_auth_admin');
  await assert.rejects(()=>db.query('delete from auth.users where id=$1',[ids.orders]),/foreign key constraint/);
  await db.exec('reset role');
  assert.deepEqual((await db.query('select * from public.orders')).rows,originalOrders);
  assert.equal((await db.query('select id from auth.users where id=$1',[ids.orders])).rows.length,1);
  assert.equal((await db.query('select id from public.profiles where id=$1',[ids.orders])).rows.length,1);
  assert.equal((await db.query('select * from private.username_login_attempts where profile_id=$1',[ids.orders])).rows.length,1);

  await db.exec('set role supabase_auth_admin');await db.query('delete from auth.users where id=$1',[ids.otherAdmin]);
  await assert.rejects(()=>db.query('delete from auth.users where id=$1',[ids.admin]),/último administrador ativo/);
  await db.exec('reset role');
  assert.equal((await db.query('select id from auth.users where id=$1',[ids.admin])).rows.length,1);
  assert.equal((await db.query("select id from public.profiles where role='admin' and active")).rows.length,1);
  await db.exec('set role authenticated');
  await assert.rejects(()=>db.query('delete from public.profiles where id=$1',[ids.orders]),/permission denied/);
 }finally{await db.close();}
});

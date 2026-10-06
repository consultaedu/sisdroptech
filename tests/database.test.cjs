const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
// Install @electric-sql/pglite externally and set PGLITE_MODULE, or use a local dev dependency.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const ids={admin:'00000000-0000-0000-0000-000000000001',a:'00000000-0000-0000-0000-000000000002',b:'00000000-0000-0000-0000-000000000003',off:'00000000-0000-0000-0000-000000000004'};
const order=id=>({id,date:'06/10/2026 10:00',client:'Cliente teste',cnpj:'00.000.000/0001-00',ie:'Isento',buyer:'Pessoa teste',phone:'27999999999',payment:'Pix à Vista',items:[{product:'Mangueira',detail:'50m',meters:50,unitPrice:2,subtotal:100}],gross:100,discountPct:10,discountVal:10,final:90});
test('PostgreSQL real: RLS separa vendedores, bloqueia promoção, acesso anônimo e conta inativa; admin vê tudo',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/202610060001_workspace.sql'),'utf8'));
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

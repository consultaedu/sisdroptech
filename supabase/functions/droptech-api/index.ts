import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = (Deno.env.get('APP_ORIGINS') || '').split(',').map(s=>s.trim()).filter(Boolean);
const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

Deno.serve(async (request:Request) => {
  const origin=request.headers.get('Origin')||'';
  if (!allowedOrigins.includes(origin)) return new Response('Origem não autorizada',{status:403});
  const headers={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
  const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(request.method==='OPTIONS')return reply({});
  if(request.method!=='POST')return reply({message:'Método inválido'},405);
  try {
    const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
    const {data:{user},error:authError}=await admin.auth.getUser(token);
    if(authError||!user)return reply({message:'Sessão inválida'},401);
    const {data:profile,error:profileError}=await admin.from('profiles').select('id,role,active').eq('id',user.id).single();
    if(profileError||!profile?.active)return reply({message:'Acesso não liberado'},403);
    const text=await request.text();
    if(text.length>16000)return reply({message:'Requisição muito grande'},413);
    const body=JSON.parse(text);
    if(body.action==='create_seller') {
      if(profile.role!=='admin')return reply({message:'Apenas administradores podem cadastrar vendedores'},403);
      if(typeof body.email!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)||typeof body.name!=='string'||!body.name.trim()||body.name.length>120||typeof body.password!=='string'||body.password.length<12||body.password.length>200)return reply({message:'Informe nome, e-mail e senha temporária com pelo menos 12 caracteres'},400);
      const {data,error}=await admin.auth.admin.createUser({email:body.email.trim(),password:body.password,email_confirm:true,user_metadata:{full_name:body.name.trim()}});
      if(error)return reply({message:error.message},400);
      const {error:activateError}=await admin.from('profiles').update({active:true}).eq('id',data.user.id).eq('role','seller');
      if(activateError)return reply({message:'Conta criada sem ativação. Confira o cadastro no painel.'},500);
      return reply({message:'Vendedor cadastrado',id:data.user.id});
    }
    if(body.action==='set_seller_active') {
      if(profile.role!=='admin')return reply({message:'Apenas administradores podem alterar acesso'},403);
      if(typeof body.active!=='boolean'||typeof body.id!=='string')return reply({message:'Dados inválidos'},400);
      // Administrators cannot disable/promote themselves or another admin through this endpoint.
      const {data,error}=await admin.from('profiles').update({active:body.active}).eq('id',body.id).eq('role','seller').select('id');
      if(error||data?.length!==1)return reply({message:'Vendedor não encontrado'},400);
      return reply({message:body.active?'Acesso ativado':'Acesso desativado'});
    }
    if(body.action==='sync_google') {
      if(!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>100||!body.ids.every((id:unknown)=>typeof id==='string'&&id.length<=100))return reply({message:'Selecione entre 1 e 100 pedidos'},400);
      // Use caller JWT so RLS restricts the records even inside a service function.
      const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
      const ids=[...new Set(body.ids)];
      const {data:orders,error}=await caller.from('orders').select('id,payload').in('id',ids);
      if(error||orders?.length!==ids.length)return reply({message:'Pedido não encontrado ou sem permissão'},403);
      const {data:settings}=await admin.from('app_settings').select('google_script_url').eq('id',true).single();
      const secret=Deno.env.get('GOOGLE_SYNC_TOKEN')||'';
      if(!secret||!settings?.google_script_url)return reply({message:'O administrador ainda não configurou o envio ao Google'},409);
      if(!/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(settings.google_script_url))return reply({message:'Destino Google inválido'},400);
      let result;
      try {
        const response=await fetch(settings.google_script_url,{method:'POST',redirect:'follow',headers:{'Content-Type':'application/json'},body:JSON.stringify({serverToken:secret,payload:{version:1,requestId:crypto.randomUUID(),orders:orders.map(o=>o.payload)}}),signal:AbortSignal.timeout(85000)});
        result=await response.json();
        if(!response.ok||!result.ok||!Array.isArray(result.orderIds)||ids.some(id=>!result.orderIds.includes(id))||!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+\/edit$/.test(result.spreadsheetUrl||''))throw new Error(result.message||'O Google não confirmou todos os pedidos.');
      } catch {
        await admin.from('orders').update({google_state:'error',google_error:'Envio sem confirmação. O pedido está salvo no banco; reenviar não cria duplicata.'}).in('id',ids);
        return reply({message:'O pedido está salvo no banco, mas o Google não confirmou o envio. Tente reenviar.'},502);
      }
      const {error:statusError}=await admin.from('orders').update({google_state:'sent',google_error:''}).in('id',ids);
      await admin.from('app_settings').update({google_sheet_url:result.spreadsheetUrl}).eq('id',true).eq('google_script_url',settings.google_script_url);
      if(statusError)return reply({message:'O Google confirmou o envio, mas o estado no banco não foi atualizado. Um reenvio é seguro.'},502);
      // Full spreadsheet is shared with administrators only, never exposed to sellers.
      return reply({message:ids.length+' pedido(s) confirmado(s) no Google',...(profile.role==='admin'?{spreadsheetUrl:result.spreadsheetUrl}:{})});
    }
    return reply({message:'Ação inválida'},400);
  } catch {return reply({message:'Falha ao executar a operação. Confira a conexão e tente novamente.'},500);}
});

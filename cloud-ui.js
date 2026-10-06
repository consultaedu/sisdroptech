(function(root){
 function start({store,getSales,setSales,resetDraft,hasDraft,render,legacyOrders}) {
  const el=id=>document.getElementById(id);
  let profile=null,settings=null,users=[],busy=false,epoch=0;
  const showStatus=(id,message)=>el(id).textContent=message;
  function locked(message='Entre para acessar seus pedidos.') {
   profile=null;settings=null;users=[];++epoch;
   setSales([]);resetDraft();el('orderSearch').value='';el('adminPanel').hidden=true;
   el('accountControls').hidden=true;el('cloudWorkspace').hidden=true;
   el('topbarNav').hidden=true;
   el('authGate').hidden=false;el('orderPreview').close();
   showStatus('authStatus',message);render();
  }
  function controls() {
   el('authGate').hidden=true;el('cloudWorkspace').hidden=false;el('accountControls').hidden=false;
   el('topbarNav').hidden=false;
   el('accountName').textContent=profile.full_name||profile.email;
   el('accountRole').textContent=profile.role==='admin'?'Administrador':'Vendedor';
   el('adminPanel').hidden=profile.role!=='admin';
   el('googleSettings').hidden=profile.role!=='admin';
   el('integrationNav').hidden=profile.role!=='admin';
   el('googleScriptUrl').value=settings.google_script_url||'';
   el('googleEnvironment').value=settings.environment;
   el('googleAutoSend').checked=settings.google_auto_send;
   el('legacyGoogleConnect').hidden=true;el('legacyGoogleHelp').hidden=true;
   el('sessionGoogleConnect').hidden=true;
   el('googleHelpText').textContent=settings.google_configured?'Acompanhe os pedidos enviados pelo sistema.':'Os pedidos ficam salvos no banco. O administrador pode configurar também o envio ao Google.';
   el('googleSetupGuide').href='LOGIN-E-BANCO.md';
   const link=el('googleSpreadsheetLink');
   link.hidden=profile.role!=='admin'||!settings.google_sheet_url;
   if(!link.hidden)link.href=settings.google_sheet_url;
   el('googleEnvironmentStatus').textContent=`Banco: ${settings.environment} • ${!settings.google_configured?'Google ainda não configurado':settings.google_auto_send?'envio automático ao Google ativado':'envio automático ao Google desativado'}`;
   el('migrationPanel').hidden=profile.role!=='admin'||!legacyOrders.length;
   el('legacyCount').textContent=legacyOrders.length;
  }
  async function reload({quiet=false}={}) {
   if(busy)return;busy=true;const version=epoch;
   el('refreshOrders').disabled=true;
   try {
    const nextProfile=await store.restore();
    if(!nextProfile){locked();return;}
    const [nextSettings,orders]=await Promise.all([store.settings(),store.listOrders()]);
    if(version!==epoch)return;
    if(profile && profile.id!==nextProfile.id){resetDraft();users=[];el('orderPreview').close();el('orderSearch').value='';setSales([]);}
    profile=nextProfile;settings=nextSettings;setSales(orders);controls();render();
    if(profile.role==='admin')await loadUsers();
    if(!quiet)showStatus('cloudStatus','Pedidos atualizados pelo banco de dados.');
   }catch(error){
    if(!store.hasSession()){locked(error.message);return;}
    if(!profile)locked(error.message);
    else showStatus('cloudStatus','Não foi possível atualizar: '+error.message+' O pedido em preenchimento foi mantido.');
   }finally{busy=false;el('refreshOrders').disabled=false;}
  }
  async function loadUsers() {
   users=await store.users();
   const tbody=el('usersList');tbody.innerHTML='';const owners=el('migrationOwner');owners.innerHTML='';
   for(const user of users){
    const row=document.createElement('div');row.className='user-row';
    const text=document.createElement('div');text.textContent=(user.full_name||user.email)+' · '+user.email;
    const state=document.createElement('small');state.textContent=(user.role==='admin'?'Administrador':'Vendedor')+' · '+(user.active?'Ativo':'Desativado');text.appendChild(state);row.appendChild(text);
    if(user.role==='seller'){
     const button=document.createElement('button');button.className='button secondary';button.type='button';button.textContent=user.active?'Desativar':'Ativar';
     button.addEventListener('click',async()=>{
      if(!confirm(`${user.active?'Desativar':'Ativar'} o acesso de ${user.full_name||user.email}?`))return;
      button.disabled=true;
      try{const result=await store.action({action:'set_seller_active',id:user.id,active:!user.active});showStatus('adminStatus',result.message);await loadUsers();}
      catch(error){showStatus('adminStatus',error.message);}finally{button.disabled=false;}
     });row.appendChild(button);
    }
    tbody.appendChild(row);
    if(user.active){const option=document.createElement('option');option.value=user.id;option.textContent=user.full_name||user.email;owners.appendChild(option);}
   }
   render();
  }
  el('loginForm').addEventListener('submit',async event=>{
   event.preventDefault();el('loginButton').disabled=true;showStatus('authStatus','Entrando…');
   try{await store.signIn(el('loginEmail').value.trim(),el('loginPassword').value);el('loginPassword').value='';await reload();}
   catch(error){showStatus('authStatus',error.status===400?'E-mail ou senha inválidos.':error.message);}
   finally{el('loginButton').disabled=false;}
  });
  el('logoutButton').addEventListener('click',async()=>{
   if(hasDraft()&&!confirm('Sair e descartar o pedido que ainda está em preenchimento?'))return;
   locked('Sessão encerrada.');await store.signOut();
  });
  el('recoverButton').addEventListener('click',async()=>{
   if(!el('loginEmail').value||!el('loginEmail').checkValidity()){showStatus('authStatus','Informe um e-mail válido no campo acima.');el('loginEmail').focus();return;}
   el('recoverButton').disabled=true;
   try{await store.recover(el('loginEmail').value.trim(),location.origin+location.pathname);showStatus('authStatus','Se o e-mail estiver cadastrado, você receberá um link para definir sua senha.');}
   catch(error){showStatus('authStatus',error.message);}finally{el('recoverButton').disabled=false;}
  });
  el('passwordForm').addEventListener('submit',async event=>{
   event.preventDefault();el('passwordButton').disabled=true;
   try{await store.changePassword(el('newPassword').value);el('newPassword').value='';el('passwordForm').hidden=true;el('loginForm').hidden=false;await store.signOut();locked('Senha atualizada. Entre com a nova senha.');}
   catch(error){showStatus('authStatus',error.message);}finally{el('passwordButton').disabled=false;}
  });
  el('changePasswordButton').addEventListener('click',()=>{el('passwordForm').hidden=false;el('loginForm').hidden=true;el('authGate').hidden=false;el('cloudWorkspace').hidden=true;showStatus('authStatus','Defina sua nova senha.');});
  el('cancelPassword').addEventListener('click',()=>{el('passwordForm').hidden=true;el('loginForm').hidden=false;if(profile)controls();else locked();});
  el('refreshOrders').addEventListener('click',()=>reload());
  el('newSellerForm').addEventListener('submit',async event=>{
   event.preventDefault();el('createSellerButton').disabled=true;
   try{const result=await store.action({action:'create_seller',name:el('sellerName').value.trim(),email:el('sellerEmail').value.trim(),password:el('sellerPassword').value});el('newSellerForm').reset();showStatus('adminStatus',result.message+' Peça ao vendedor para alterar a senha ao entrar.');await loadUsers();}
   catch(error){showStatus('adminStatus',error.message);}finally{el('createSellerButton').disabled=false;}
  });
  el('importLegacyButton').addEventListener('click',async()=>{
   const owner=users.find(u=>u.id===el('migrationOwner').value);
   if(!owner||!confirm(`Importar ${legacyOrders.length} pedido(s) antigos para ${owner.full_name||owner.email}? A cópia deste navegador será mantida.`))return;
   el('importLegacyButton').disabled=true;
   try{await store.importOrders(legacyOrders,owner.id);showStatus('adminStatus','Importação concluída. Pedidos repetidos não foram duplicados e a cópia local foi mantida.');await reload();}
   catch(error){showStatus('adminStatus',error.message+' A cópia local foi mantida.');}finally{el('importLegacyButton').disabled=false;}
  });
  // Focus refresh gives a phone/PC the current central data without replacing a draft.
  root.addEventListener('focus',()=>{if(profile&&!document.hidden)reload({quiet:true});});
  root.addEventListener('storage',event=>{if(event.key?.startsWith('droptech_auth_'))reload({quiet:true});});
  const timer=setInterval(()=>{if(profile&&!document.hidden)reload({quiet:true});},60000);
  root.addEventListener('beforeunload',()=>clearInterval(timer));
  async function init() {
   locked('Verificando acesso…');
   try{
    if(await store.recoverySession(location.hash)){
     history.replaceState(null,'',location.pathname+location.search);el('passwordForm').hidden=false;el('loginForm').hidden=true;showStatus('authStatus','Defina uma nova senha para recuperar sua conta.');return;
    }
    if(location.hash.includes('access_token')||location.hash.includes('error_description'))history.replaceState(null,'',location.pathname+location.search);
    await reload();
   }catch(error){locked(error.message);}
  }
  init();
  return {
   reload, profile:()=>profile, settings:()=>settings,
   async saveSettings(data){if(profile?.role!=='admin')throw new Error('Somente o administrador pode configurar o Google.');await store.saveSettings(data);await reload();showStatus('exportStatus','Configuração compartilhada atualizada.');},
   async sync(orders){
    if(!profile)throw new Error('Entre na sua conta.');
    if(!orders.length)throw new Error('Não há pedidos para enviar.');
    if(orders.length>100)throw new Error('Selecione até 100 pedidos por envio.');
    showStatus('exportStatus','Enviando os pedidos salvos no banco ao Google…');
    try{const result=await store.action({action:'sync_google',ids:orders.map(o=>o.id)});await reload({quiet:true});showStatus('exportStatus',result.message);}
    catch(error){showStatus('exportStatus',error.message);await reload({quiet:true});throw error;}
   },
   requireAccount(){if(!profile||!store.hasSession())throw new Error('Entre novamente na sua conta para continuar.');},
   expire(message){locked(message);},
   label(order){return {sent:'Confirmado no Google',error:'Falha no envio — reenviar',not_sent:'Salvo no banco'}[order.googleState]||'Salvo no banco';},
   ownerName(id){return users.find(u=>u.id===id)?.full_name||users.find(u=>u.id===id)?.email||'';}
  };
 }
 root.CloudUI={start};
})(window);

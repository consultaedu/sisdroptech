(function(root){
 function start({store,getSales,setSales,resetDraft,hasDraft,render,legacyOrders}) {
  const el=id=>document.getElementById(id);
  let profile=null,settings=null,users=[],busy=false,epoch=0,recoveryBusy=false,recoveryEpoch=0,passwordRecovery=false;
  const showStatus=(id,message,state='')=>{el(id).textContent=message;el(id).dataset.state=state;};
  el('loginEmail').value=store.savedLogin();
  el('rememberLogin').checked=!!store.savedLogin()||el('rememberLogin').checked;
  function locked(message='Entre para acessar seus pedidos.') {
   profile=null;settings=null;users=[];passwordRecovery=false;++epoch;++recoveryEpoch;
   setSales([]);resetDraft();el('orderSearch').value='';el('adminPanel').hidden=true;
   el('accountControls').hidden=true;el('cloudWorkspace').hidden=true;
   el('topbarNav').hidden=true;
   el('authGate').hidden=false;el('orderPreview').close();
   el('loginPassword').value='';el('newPassword').value='';
   el('loginForm').hidden=false;el('passwordForm').hidden=true;el('recoveryForm').hidden=true;
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
   el('sellerUsernameField').hidden=!settings.username_login;
   el('sellerUsername').disabled=!settings.username_login;
   el('sellerUsername').required=!!settings.username_login;
   el('legacyCount').textContent=legacyOrders.length;
  }
  async function reload({quiet=false}={}) {
   if(busy||passwordRecovery)return;busy=true;const version=epoch;
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
   const version=epoch;const nextUsers=await store.users();
   if(version!==epoch||profile?.role!=='admin')return;
   users=nextUsers;
   const tbody=el('usersList');tbody.innerHTML='';const owners=el('migrationOwner');owners.innerHTML='';
   for(const user of users){
    const row=document.createElement('div');row.className='user-row';
    const text=document.createElement('div');text.textContent=(user.full_name||user.email)+' · '+user.email;
    const state=document.createElement('small');state.textContent=(user.role==='admin'?'Administrador':'Vendedor')+' · '+(user.active?'Ativo':'Desativado');text.appendChild(state);row.appendChild(text);
    const actions=document.createElement('div');actions.className='user-access-actions';
    if(settings.username_login){
     const form=document.createElement('form');form.className='username-form';
     const label=document.createElement('label');label.textContent='Usuário';label.htmlFor='username-'+user.id;
     const input=document.createElement('input');input.id=label.htmlFor;input.type='text';input.value=user.username||'';input.required=true;input.minLength=3;input.maxLength=32;input.pattern='[a-zA-Z0-9][a-zA-Z0-9._\\-]{2,31}';input.autocomplete='off';input.autocapitalize='none';input.spellcheck=false;
     const save=document.createElement('button');save.type='submit';save.className='button secondary';save.textContent='Salvar usuário';
     form.append(label,input,save);actions.appendChild(form);
     form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;
      try{const result=await store.action({action:'set_username',id:user.id,username:input.value.trim()});showStatus('adminStatus',result.message);if(user.id===profile.id&&el('rememberLogin').checked){store.rememberLogin(result.username,true);el('loginEmail').value=result.username;}await loadUsers();}
      catch(error){showStatus('adminStatus',error.message);}finally{save.disabled=false;}
     });
    }
    if(user.role==='seller'){
     const button=document.createElement('button');button.className='button secondary';button.type='button';button.textContent=user.active?'Desativar':'Ativar';
     button.addEventListener('click',async()=>{
      if(!confirm(`${user.active?'Desativar':'Ativar'} o acesso de ${user.full_name||user.email}?`))return;
      button.disabled=true;
      try{const result=await store.action({action:'set_seller_active',id:user.id,active:!user.active});showStatus('adminStatus',result.message);await loadUsers();}
      catch(error){showStatus('adminStatus',error.message);}finally{button.disabled=false;}
     });actions.appendChild(button);
    }
    if(actions.childElementCount)row.appendChild(actions);
    tbody.appendChild(row);
    if(user.active){const option=document.createElement('option');option.value=user.id;option.textContent=user.full_name||user.email;owners.appendChild(option);}
   }
   render();
  }
  el('loginForm').addEventListener('submit',async event=>{
   event.preventDefault();el('loginButton').disabled=true;showStatus('authStatus','Entrando…');
   try{const account=await store.signIn(el('loginEmail').value.trim(),el('loginPassword').value);const identifier=account.username||el('loginEmail').value.trim();store.rememberLogin(identifier,el('rememberLogin').checked);el('loginEmail').value=identifier;el('loginPassword').value='';await reload();}
   catch(error){el('loginPassword').value='';showStatus('authStatus',error.status===400?'Usuário ou senha inválidos.':error.message);}
   finally{el('loginButton').disabled=false;}
  });
  el('logoutButton').addEventListener('click',async()=>{
   if(hasDraft()&&!confirm('Sair e descartar o pedido que ainda está em preenchimento?'))return;
   locked('Sessão encerrada.');await store.signOut();
  });
  el('rememberLogin').addEventListener('change',()=>{if(!el('rememberLogin').checked)store.rememberLogin('',false);});
  el('recoverButton').addEventListener('click',()=>{
   ++recoveryEpoch;el('recoveryEmail').removeAttribute('aria-invalid');
   el('recoveryEmail').value=el('loginEmail').value.includes('@')?el('loginEmail').value:'';
   el('loginForm').hidden=true;el('recoveryForm').hidden=false;el('loginPassword').value='';
   showStatus('authStatus','Informe seu e-mail cadastrado para receber o link de recuperação.');
  });
  el('cancelRecovery').addEventListener('click',()=>{++recoveryEpoch;el('recoveryForm').hidden=true;el('loginForm').hidden=false;showStatus('authStatus','Entre com seu usuário e senha.');});
  el('recoveryEmail').addEventListener('invalid',event=>{
   event.preventDefault();el('recoveryEmail').setAttribute('aria-invalid','true');el('recoveryEmail').focus();
   showStatus('authStatus',el('recoveryEmail').validity.valueMissing?'Informe seu e-mail cadastrado antes de enviar.':'Informe um e-mail válido, por exemplo: nome@gmail.com.','error');
  });
  el('recoveryEmail').addEventListener('input',()=>{
   if(el('recoveryEmail').hasAttribute('aria-invalid')){
    el('recoveryEmail').removeAttribute('aria-invalid');showStatus('authStatus','Informe seu e-mail cadastrado para receber o link de recuperação.');
   }
  });
  el('recoveryForm').addEventListener('submit',async event=>{
   event.preventDefault();if(recoveryBusy)return;
   const email=el('recoveryEmail');email.value=email.value.trim();if(!email.reportValidity())return;
   const attempt=++recoveryEpoch;recoveryBusy=true;el('sendRecoveryButton').disabled=true;
   el('sendRecoveryButton').textContent='Enviando link…';el('recoveryForm').setAttribute('aria-busy','true');email.readOnly=true;
   showStatus('authStatus','Solicitando o link de recuperação. Aguarde…','pending');
   try{
    await store.recover(email.value,location.origin+location.pathname);
    if(attempt===recoveryEpoch)showStatus('authStatus','Solicitação enviada. Se o e-mail estiver cadastrado, você receberá um link para definir sua senha. Confira também a pasta de spam.','success');
   }catch(error){
    if(attempt===recoveryEpoch)showStatus('authStatus',error.status===429?'Muitas tentativas de recuperação. Aguarde alguns minutos e tente novamente.':error.name==='TypeError'?'Não foi possível solicitar o link. Confira sua conexão e tente novamente.':'Não foi possível solicitar o link: '+error.message,'error');
   }finally{
    recoveryBusy=false;el('sendRecoveryButton').disabled=false;el('sendRecoveryButton').textContent='Enviar link de recuperação';el('recoveryForm').removeAttribute('aria-busy');email.readOnly=false;
   }
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
   try{const result=await store.action({action:'create_seller',name:el('sellerName').value.trim(),email:el('sellerEmail').value.trim(),password:el('sellerPassword').value,...(settings.username_login?{username:el('sellerUsername').value.trim()}:{})});el('newSellerForm').reset();showStatus('adminStatus',result.message+' Peça ao vendedor para alterar a senha ao entrar.');await loadUsers();}
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
   const authHash=location.hash,authParams=new URLSearchParams(authHash.replace(/^#/,''));
   const recoveryLink=authParams.get('type')==='recovery',linkError=authParams.has('error')||authParams.has('error_code')||authParams.has('error_description');
   if(authParams.has('access_token')||authParams.has('refresh_token')||recoveryLink||linkError)history.replaceState(null,'',location.pathname+location.search);
   try{
    passwordRecovery=recoveryLink;
    if(await store.recoverySession(authHash)){
     el('passwordForm').hidden=false;el('loginForm').hidden=true;showStatus('authStatus','Defina uma nova senha para recuperar sua conta.');el('newPassword').focus();return;
    }
    passwordRecovery=false;
    await reload();
   }catch(error){
    locked(error.message);
    if(recoveryLink||linkError){
     el('recoveryEmail').value=el('loginEmail').value.includes('@')?el('loginEmail').value:'';
     el('loginForm').hidden=true;el('recoveryForm').hidden=false;
     showStatus('authStatus',error.message,'error');
    }
   }
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

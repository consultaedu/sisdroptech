# Login e banco compartilhado — instalação no projeto de teste

O projeto Supabase de teste é `ihrwhfmsnclbusjdatiy`. O código de login está preparado,
mas só pode ser ativado depois da instalação abaixo. O site continua no modo anterior
enquanto `backend-config.js` tiver `enabled: false`.

## 1. Instalar as tabelas e permissões

No painel do projeto Supabase, abra **SQL Editor → New query**. Copie o conteúdo completo
de `supabase/migrations/202610060001_workspace.sql` e clique em **Run** uma única vez.
A migração roda dentro de uma transação: se ocorrer um erro, nenhuma parte é instalada.

São criadas as tabelas `profiles`, `orders` e `app_settings`. Todas têm Row Level Security.
O vendedor lê, salva e exclui apenas seus próprios pedidos. O administrador vê todos,
configura a integração e pode importar os pedidos antigos atribuindo-os ao vendedor correto.
Os campos de acesso e a confirmação do Google não podem ser alterados pelo navegador.

## 2. Criar a primeira conta de administrador

Em **Authentication → Users → Add user → Create new user**, crie seu usuário com e-mail
e uma senha definida por você. Confirme o e-mail na criação (**Auto Confirm User**).
Não é necessário compartilhar essa senha comigo.

Depois rode no SQL Editor, substituindo apenas o e-mail:

```sql
update public.profiles
set full_name = 'Administrador de teste', role = 'admin', active = true
where email = 'SEU-EMAIL-AQUI'
returning id, email, role, active;
```

É necessário retornar exatamente uma linha. Contas criadas por qualquer outro caminho
começam como vendedor **desativado**; dados enviados pelo usuário não concedem papel de admin.
Desabilite **Allow new users to sign up** nas configurações de Auth. Os vendedores serão
cadastrados pelo administrador, usando a função do servidor.

## 3. Configurar recuperação de senha

Em **Authentication → URL Configuration**, use:

- Site URL: `https://consultaedu.github.io/sisdroptech/`
- Redirect URL: `https://consultaedu.github.io/sisdroptech/`

Para desenvolvimento local, pode adicionar `http://127.0.0.1:4173/`.
Configure um provedor SMTP para o ambiente oficial, conforme a documentação do Supabase.
Configure a política de senha com pelo menos 12 caracteres. Não coloque senhas no repositório.

## 4. Instalar a função de administração e Google

No Supabase, abra **Edge Functions** e crie a função **droptech-api**.
Use o código completo em `supabase/functions/droptech-api/index.ts`.
Desative a verificação JWT legada da plataforma para essa função; o próprio código exige
um token de usuário válido usando `auth.getUser` e confere o perfil ativo em toda requisição.
Sem token válido, ou sem ser admin, o endpoint não permite cadastrar/desativar vendedores.

Os secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidos
pelo ambiente Supabase. Adicione o secret:

```
APP_ORIGINS=https://consultaedu.github.io
```

O Origin contém apenas domínio e protocolo, sem `/sisdroptech/`.
Para testar a função localmente, pode incluir `http://127.0.0.1:4173` separado por vírgula.
Nunca coloque a `service_role` ou Secret Key em `backend-config.js`, HTML ou GitHub.

Com a CLI Supabase instalada, a alternativa é:

```sh
supabase link --project-ref ihrwhfmsnclbusjdatiy
supabase db push
supabase secrets set APP_ORIGINS=https://consultaedu.github.io
supabase functions deploy droptech-api --no-verify-jwt
```

Use SQL Editor **ou** `db push`, evitando aplicar a mesma migração duas vezes.

## 5. Ativar o envio do Google pelo servidor

O banco funciona mesmo sem Google. Para enviar sem pop-up ou configuração por aparelho:

1. Gere um token aleatório de pelo menos 32 caracteres usando um gerenciador de senhas.
2. No **Apps Script → Configurações do projeto → Propriedades do script**, crie
   `DROPTECH_SERVER_TOKEN` com esse valor.
3. Substitua o código Apps Script por `google-apps-script.gs` desta versão.
4. Publique uma nova versão do aplicativo web, executando como o proprietário e permitindo
   acesso ao endpoint por **Qualquer pessoa**. O token passa a ser obrigatório para receber pedidos.
5. Nos secrets da Edge Function Supabase, crie `GOOGLE_SYNC_TOKEN` com o mesmo valor.
6. Na tela do sistema, o administrador configura a URL `/exec` e o envio automático uma vez.

O token existe apenas nos dois servidores. A função lê os pedidos pelo token do vendedor e
as políticas do banco antes de exportar; ela não aceita os dados brutos fornecidos pelo navegador.
O endpoint público Google não mostra a planilha nem aceita os envios legados quando o token está configurado.
Somente o administrador recebe o link da planilha geral no sistema. Mantenha a planilha restrita
no Google Drive; não compartilhe a planilha geral com vendedores que só podem consultar seus pedidos.

Falhas do Google não apagam o pedido no banco. O histórico mostra a falha e permite reenviar.
Os IDs estáveis e o controle existente do Apps Script evitam duplicação por reenvio.
Envios interrompidos por fechar o navegador podem ser conferidos/reenviados pelo histórico.
Não há garantia de envio em segundo plano com navegador fechado; o banco continua sendo a fonte principal.

## 6. Ativar o site depois da instalação

O arquivo `backend-config.js` já contém a URL e a chave **pública** informadas.
Depois de verificar as tabelas e o admin, mude `enabled` para `true` e publique essa versão.
Uma configuração habilitada mas inválida não deve cair para o histórico local.

Validação obrigatória no ambiente real:

1. Admin entra e cadastra vendedores A e B.
2. A salva um pedido no computador e entra no celular: o pedido aparece.
3. B entra em outra sessão: não vê o pedido de A.
4. Admin entra: vê os pedidos e o vendedor responsável.
5. Admin desativa A: A perde acesso ao banco na próxima operação/atualização.
6. PDF, CSV e seleção usam somente os pedidos acessíveis à conta.
7. Configure Google e envie um pedido; confirme o estado no banco e a guia na planilha.

Atualização dos pedidos ocorre ao entrar, ao focar a página, pelo botão **Atualizar pedidos**
e a cada 60 segundos enquanto a página está visível. Isso preserva um pedido ainda em preenchimento.
O sistema exige conexão para carregar e salvar; não cria uma segunda lista local de pedidos em modo nuvem.
Não confirme um pedido como salvo se o servidor não responder. O formulário e seu ID de tentativa
são mantidos para nova tentativa na mesma página sem duplicação.

## 7. Migrar pedidos antigos

Abra o site no mesmo navegador e endereço onde os pedidos antigos foram salvos.
Entre como administrador. No painel **Equipe de vendas**, escolha o vendedor responsável
pelos pedidos locais e clique em **Importar pedidos antigos**.

Os pedidos mantêm seus IDs e valores. Pedidos repetidos não são duplicados; conflitos de vendedor
ou conteúdo interrompem a importação. A cópia local não é apagada. A atribuição precisa ser feita
pelo administrador porque os pedidos antigos não continham identificação de vendedor autenticado.
Se havia pedidos em outros aparelhos/navegadores, faça a importação também neles, conferindo o responsável.

## 8. Conta oficial da DropTech

Crie um novo projeto pertencente à DropTech, repita a instalação e configure um Apps Script
e token próprios. Troque URL/chave pública no arquivo de configuração e as URLs de Auth e APP_ORIGINS.
Pedidos de teste não são enviados ao projeto oficial automaticamente. Migre somente os dados escolhidos.
Configure backup/recuperação adequados ao plano contratado antes de usar pedidos de produção.

## Testes de desenvolvimento

```sh
node tests/orders.test.cjs
node tests/cloud-store.test.cjs
node tests/edge-function.test.cjs
node tests/database.test.cjs
node tests/serve.cjs
node tests/cloud-browser.test.cjs
```

Os testes do banco exigem `@electric-sql/pglite`; a variável `PGLITE_MODULE` pode apontar para
uma instalação externa. Os de navegador exigem `playwright`; configure `PLAYWRIGHT_MODULE`
e opcionalmente `BROWSER_EXECUTABLE`. Esses testes usam dados fictícios e serviços simulados.
Eles não substituem a validação real depois da instalação no Supabase e Google.

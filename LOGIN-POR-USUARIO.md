# Login por usuário no projeto existente

Esta atualização acrescenta um nome de usuário às contas atuais. Mantém os pedidos, os administradores, os vendedores e suas senhas. O e-mail continua disponível para entrar e recuperar a senha.

## 1. Atualizar o banco

No projeto atual do Supabase, abra **SQL Editor → New query**.

Copie todo o conteúdo de:

`supabase/migrations/202610070001_usernames.sql`

Cole no editor e clique em **Run**. Execute esse arquivo somente uma vez. Não execute novamente os arquivos de instalação inicial.

Se o painel mostrar um aviso sobre RLS, escolha **Run and enable RLS**. O arquivo atualizado já habilita essa proteção explicitamente.

Se você já executou a versão anterior, execute somente `supabase/migrations/202610070002_usernames_rls.sql`. Não execute novamente a migração que cria os nomes de usuário.

O resultado esperado é **Success. No rows returned**. Cada conta receberá um usuário baseado na parte anterior ao @ do e-mail, em letras minúsculas. Quando houver nomes repetidos, será acrescentado um número.

## 2. Atualizar a função do servidor

Abra **Edge Functions → droptech-api → Code**. Substitua todo o conteúdo de **index.ts** pelo arquivo:

`supabase/functions/droptech-api/index.ts`

Clique em **Deploy updates** (ou **Deploy function**). Continue usando a função existente, com o nome **droptech-api**.

Em **Details → Function configuration**, mantenha **Verify JWT with legacy secret** desligado. O código verifica a senha no Supabase Auth para o login e verifica a sessão e as permissões para as outras operações.

Em **Edge Functions → Secrets**, configure `APP_ORIGINS` com:

```text
https://pedidos.droptech.com.br,https://droptechmangueiras.github.io
```

Os endereços acima são separados por vírgula, sem caminho ou barra final. Depois de salvar, publique novamente a função caso o painel solicite. O domínio oficial foi adicionado ao GitHub durante esta atualização; a verificação anterior à instalação retornou 403 para ele e 200 para o domínio do GitHub.

Mantenha o valor existente de `GOOGLE_SYNC_TOKEN` e a configuração do Google Planilhas.

Em **Authentication → URL Configuration**, use **Site URL** `https://pedidos.droptech.com.br/` e acrescente essa mesma URL em **Redirect URLs**. Mantenha também `https://droptechmangueiras.github.io/sisdroptech/` se esse endereço continuar sendo utilizado para testes.

## 3. Configurar a senha mínima

Em **Authentication → Sign In / Providers → Email**, encontre **Minimum password length**, coloque **6** e salve.

O Supabase hospedado aceita um mínimo de 6 caracteres. Quatro caracteres não são aceitos pela configuração de Auth. Se houver regras adicionais de composição da senha, elas também precisam ser atendidas.

Referência: [esquema oficial da API do Supabase](https://github.com/supabase/supabase/blob/master/apps/docs/spec/api_v1_openapi.json), campo `UpdateAuthConfigBody.password_min_length`.

As senhas atuais não mudam automaticamente. Para escolher uma senha mais curta, a pessoa entra com a senha atual e usa o botão **Senha** no sistema.

## 4. Definir os nomes de usuário

Abra [o sistema da DropTech](https://pedidos.droptech.com.br/) e entre como administrador usando o e-mail e a senha atuais.

No painel de usuários, altere o campo **Usuário** para, por exemplo, `vendedor01` e clique em **Salvar usuário**.

Os nomes são únicos, de 3 a 32 caracteres. Use letras sem acento, números, ponto, hífen ou sublinhado; o primeiro caractere precisa ser uma letra ou número. Maiúsculas são convertidas para minúsculas.

O cadastro de novos vendedores passa a pedir nome de usuário, nome completo, e-mail de recuperação e senha.

## 5. Conferir o funcionamento

1. Saia da conta e entre com o nome de usuário e a senha atual.
2. Com **Lembrar usuário neste aparelho** marcado, saia e recarregue a página: o usuário deverá continuar preenchido, com a senha vazia.
3. Confira no celular que os mesmos pedidos aparecem para essa conta.
4. Confira que outro vendedor vê apenas seus próprios pedidos.
5. Teste **Esqueci minha senha** usando o e-mail cadastrado.

A opção de lembrar salva somente o nome de usuário nesse navegador. Ela não grava a senha. Desmarcar a opção apaga o nome lembrado. A sessão autenticada continua sendo gerenciada pelo Supabase.

## Publicação e validação

O site atualizado funciona com login por e-mail enquanto o banco e a função não forem atualizados. O campo de usuário no painel do administrador aparece depois da migração SQL.

Foram validados localmente os fluxos de usuário/e-mail, recuperação, lembrança do usuário, cadastro, alteração de nome, permissões, pedidos e PDF, com API simulada em navegador. A migração e o limite de tentativas foram validados em PostgreSQL via PGlite. O teste com a conta real depende da instalação dos passos acima.

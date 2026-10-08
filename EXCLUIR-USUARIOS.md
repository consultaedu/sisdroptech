# Excluir uma conta sem pedidos

O cadastro inicial usava uma regra que impedia excluir qualquer conta com um perfil no sistema. Esta atualização permite excluir contas sem pedidos pelo painel do Supabase.

## Instalar uma vez

1. No projeto atual do Supabase, abra **SQL Editor → New query**.
2. Copie todo o conteúdo de `supabase/migrations/202610070003_account_deletion.sql`.
3. Cole no editor e clique em **Run**. A alteração de constraint pode mostrar um aviso de alteração da estrutura do banco. Este arquivo não apaga contas nem pedidos.
4. Aguarde **Success. No rows returned**.

Não execute novamente os arquivos de instalação inicial ou a migração que cria os nomes de usuário.

## Excluir a conta

Abra **Authentication → Users**, selecione a conta e use **Delete user**. O perfil associado e seu registro de tentativas de login são removidos junto com a conta.

Se a conta tiver pedidos, o banco bloqueia a exclusão e mantém os dados. Para retirar seu acesso, use **Desativar** no painel de vendedores do sistema. Não é necessário apagar seus pedidos.

O último administrador ativo também não pode ser excluído. Cadastre e valide outro administrador antes de remover o anterior.

A exclusão pelo painel é definitiva. Este arquivo apenas habilita essa operação; ele não escolhe ou exclui nenhuma conta automaticamente.

Referência: [Supabase — perfil associado e exclusão de usuários](https://supabase.com/docs/guides/auth/managing-user-data).

## Verificação

Os testes PostgreSQL via PGlite verificam exclusão de uma conta sem pedidos, remoção do perfil associado, preservação de contas com pedidos, manutenção do controle de tentativas e bloqueio da exclusão do último administrador ativo. A instalação no projeto real precisa ser feita pelo painel.

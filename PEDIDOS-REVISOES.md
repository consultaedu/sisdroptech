# Observações, revisão com histórico e renovação

Esta atualização usa o projeto Supabase, as contas, os pedidos e a planilha que já existem. A publicação do site não executa o SQL nem atualiza a função do Supabase ou o Google Apps Script.

## Ativar na conta da DropTech

Faça as três etapas abaixo antes de usar as funções novas. Não é necessário criar outra planilha, projeto ou token.

### 1. Atualizar o Google Apps Script

Arquivo: **google-apps-script.gs**, na raiz deste repositório.

1. Abra o projeto Apps Script que já recebe os pedidos.
2. Substitua o conteúdo do arquivo de código pelo conteúdo completo de **google-apps-script.gs** e salve.
3. Mantenha as propriedades existentes, especialmente **DROPTECH_SPREADSHEET_ID** e **DROPTECH_SERVER_TOKEN**.
4. Vá a **Implantar → Gerenciar implantações**, edite a implantação atual pelo lápis, selecione **Nova versão** e clique em **Implantar**.
5. Preserve a URL atual terminada em **/exec**, a conta de execução e as permissões de acesso da implantação existente.

Cada pedido continua na mesma guia. Uma revisão atualiza essa guia com a versão atual e inclui a coluna **Observação**. A renovação cria outra guia porque tem outro número de pedido. O histórico completo das versões fica no Supabase.

### 2. Atualizar a Edge Function

Arquivo: **supabase/functions/droptech-api/index.ts**.

1. No Supabase da empresa, abra o projeto existente → **Edge Functions → droptech-api → Code**.
2. Substitua o conteúdo de **index.ts** pelo conteúdo completo do arquivo acima.
3. Publique a atualização pelo botão **Deploy updates**.
4. Mantenha **Verify JWT with legacy secret** desligado. A função continua validando a sessão e o perfil do usuário em seu próprio código.
5. Mantenha os secrets existentes, incluindo **APP_ORIGINS** e **GOOGLE_SYNC_TOKEN**.

A função exige a confirmação da versão enviada e impede que uma resposta atrasada do Google confirme uma revisão mais recente por engano.

### 3. Executar a nova migração SQL

Arquivo: **supabase/migrations/202610070004_order_revisions.sql**.

1. No mesmo projeto Supabase, abra **SQL Editor → New query**.
2. Cole o arquivo inteiro e clique em **Run**, uma única vez.
3. Aguarde a confirmação de sucesso e recarregue o sistema. Se o navegador mantiver a versão anterior, use **Ctrl + Shift + R**.

Execute somente esta migração nova no projeto que já está configurado. Não é necessário executar novamente o schema inicial ou as migrações anteriores.

O SQL conserva o conteúdo dos pedidos atuais e registra cada um como versão 1. Esses registros aparecem como **Registro anterior**, pois o sistema não registrava quem fez cada alteração antes desta atualização. A partir daqui, cada revisão registra a pessoa que a salvou, a data, o motivo e uma cópia completa do pedido.

## Como usar

- **Observação do item:** informe, por exemplo, “Cor azul, todos os rolos na mesma tonalidade”. O limite é de 500 caracteres por item. O texto acompanha o histórico do pedido, a busca, o CSV, o PDF e a guia individual no Google.
- **Editar item:** altere o produto, a metragem/rolos ou a observação no formulário e clique em **Salvar alteração do item** antes de finalizar.
- **Revisar:** abre o pedido existente para alteração. Informe o motivo e clique em **Salvar revisão**. O número, a data original e o vendedor responsável permanecem; a versão aumenta.
- **Versões:** mostra as cópias anteriores, quem salvou, quando, o motivo e as diferenças. Cada versão pode ser aberta e baixada em PDF.
- **Renovar:** preenche um novo pedido com os dados e as observações do anterior. Atualiza os preços dos produtos pela tabela atual do sistema. Confira os valores e o pagamento antes de salvar. Produtos que saíram da tabela mantêm seu preço anterior, com aviso no formulário.

Uma renovação recebe novo número, nova data e referência ao pedido de origem. Ela pertence ao usuário que salvou o novo pedido. O pedido anterior permanece intacto.

Vendedores consultam, revisam e renovam somente seus próprios pedidos; administradores podem acessar todos. Se outro aparelho revisar primeiro, o sistema recusa o salvamento da versão desatualizada e mantém o formulário para conferência. Atualize o histórico e abra novamente o pedido.

Se uma tentativa de salvar ficar sem confirmação por falha de conexão, tente salvar novamente com os mesmos dados: o identificador da tentativa evita uma segunda revisão. Cancele alterações somente depois de confirmar o resultado.

**Excluir** continua sendo uma exclusão definitiva do pedido e também remove suas versões, conforme o aviso de confirmação. Para conservar o histórico, use **Revisar**.

## Conferência depois da instalação

1. Salve um pedido de teste com observação e confira no celular, no PDF e na planilha.
2. Revise a observação com um motivo. Confira a versão 2 e abra o PDF da versão 1.
3. Verifique que a planilha mantém a mesma guia para esse pedido.
4. Renove o pedido, confira os preços e salve. Verifique o novo número e a referência ao original.
5. Entre com outro vendedor e confira que ele não vê esses pedidos.

O código foi validado com PostgreSQL local, Google Apps Script simulado e navegador em telas de PC e celular. A conferência na conta real depende das três atualizações acima.

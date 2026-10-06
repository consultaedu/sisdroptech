# Envio automático ao Google Planilhas

Ao salvar um novo pedido, o sistema salva primeiro no navegador e coloca o pedido na fila do ambiente configurado. Para enviar, conecte uma vez por sessão pelo botão **Conectar ao Google** e mantenha a aba Google aberta. Essa aba verifica o acesso à conta e usa a comunicação nativa do Apps Script (`google.script.run`) para salvar e confirmar cada lote. Não é necessário clicar em enviar para cada pedido novo.

Cada projeto Google mantém uma única planilha, com uma guia por pedido e uma guia de consulta. Reenviar um pedido com a mesma identificação não cria outra guia. CSV e PDF continuam disponíveis.

## Corrigir pedidos presos em envio

Esta atualização altera tanto o sistema local quanto o aplicativo no Google. Atualizar somente o site não basta.

1. No projeto Google Apps Script já usado pelo sistema, substitua **todo** o conteúdo de `Código.gs` pelo arquivo `google-apps-script.gs` atualizado desta pasta e salve.
2. Acesse **Implantar → Gerenciar implantações → Editar (lápis) → Nova versão → Implantar**. Use a mesma implantação para preservar a URL e a planilha de destino.
3. Recarregue o sistema. Os pedidos interrompidos passam a **Envio sem confirmação — reenviar**, sem reiniciar tentativas ocultas.
4. Clique em **Conectar ao Google**. Conclua o login/autorização, se solicitado. A nova aba deve mostrar **DropTech — conexão com o Google** e depois **Conectado**. Mantenha-a aberta e volte ao sistema.
5. Clique em **Reenviar pendentes** para recuperar os pedidos sem confirmação. O sistema reaproveita pedidos já recebidos pelo Google através de sua identificação.
6. Aguarde **Confirmado no Google** e clique em **Abrir planilha deste ambiente**. Depois, salve um novo pedido para conferir o envio automático.

Se a aba mostrar a antiga tela **Planilha deste ambiente**, o Google ainda está servindo a versão anterior: confira o passo 2 e se a URL configurada corresponde à implantação atualizada.

## Configuração inicial

1. Entre na conta Google que receberá os pedidos e abra [Google Apps Script](https://script.google.com/home/start).
2. Crie um projeto chamado **DropTech - Pedidos - Teste** enquanto estiver testando.
3. Substitua o conteúdo de `Código.gs` pelo arquivo `google-apps-script.gs` e salve.
4. Clique em **Implantar → Nova implantação** e escolha **App da Web**.
5. Para um teste ou operador usando a conta da empresa, escolha **Executar como: Eu** e **Quem pode acessar: Somente eu**. Use essa mesma conta no navegador do sistema. A planilha ficará no Drive dessa conta.
6. Clique em **Implantar**, confira as permissões de criação e edição de planilhas e autorize o aplicativo.
7. Copie a URL terminada em `/exec`.
8. No sistema, abra **Configurar Google Planilhas**, cole a URL, nomeie o ambiente **Teste** e deixe marcada **Enviar automaticamente ao salvar novos pedidos**. Clique em **Salvar configuração**.
9. Clique em **Conectar ao Google** e conclua o login. Espere **Conectado** nas duas páginas. Mantenha a aba Google aberta; pode voltar à aba do sistema.
10. Salve um pedido de demonstração. Espere **Confirmado no Google**. O link **Abrir planilha deste ambiente** abre a planilha. Um segundo pedido deve criar outra guia na mesma planilha.

Se o navegador bloquear a nova aba, permita pop-ups para o endereço do sistema e clique em **Conectar ao Google** novamente. Se o login interromper a ligação entre as abas, conclua o login e volte ao sistema para conectar novamente.

Para vários vendedores, mantenha **Executar como: Eu** na conta da empresa e configure o acesso pelo domínio Google Workspace quando disponível. **Somente eu** atende ao teste ou a um operador usando a conta autorizada. Com esse código, não use **Usuário que acessa o app** para vendedores de contas independentes: o destino é compartilhado por projeto, e essas contas podem não ter acesso à planilha central. Não configure acesso anônimo ao aplicativo.

## Passar do teste para a conta da DropTech

1. Na conta da DropTech, crie **outro projeto** do Apps Script com o mesmo código e implante-o. Outra implantação do mesmo projeto de teste compartilha a mesma planilha de destino.
2. No sistema, troque a URL pelo `/exec` do projeto da empresa, nomeie o ambiente **DropTech** e salve.
3. Clique em **Conectar ao Google** com a conta autorizada para essa implantação.
4. Salve um novo pedido de demonstração para validar o destino antes de cadastrar pedidos reais.

Trocar a URL encerra a conexão com o ambiente anterior. Não copia pedidos antigos nem transfere a fila de teste. O estado de envio é separado por URL. Pedidos anteriores só serão enviados ao novo destino se escolhidos pelo botão manual. Trocar de volta para a URL de teste permite consultar ou reenviar suas pendências.

## Estados e recuperação

- **Conecte ao Google para enviar:** há um pedido na fila, mas falta uma conexão confirmada com a aba Google.
- **Aguardando internet:** o pedido está salvo; com a aba Google conectada, retoma quando a conexão voltar.
- **Aguardando envio:** outro lote está sendo processado. Cada lote contém até 20 pedidos.
- **Enviando ao Google:** o pedido foi entregue à aba conectada; espera confirmação por até 90 segundos. Se o navegador suspender a página, o prazo é conferido também ao voltar à página.
- **Confirmado no Google:** o aplicativo respondeu com a identificação do pedido e um link válido da planilha.
- **Falha no envio:** o Google retornou erro. A fila do ambiente é pausada; confira o erro no sistema ou na aba Google e use **Reenviar pendentes** após resolvê-lo.
- **Envio sem confirmação — reenviar:** o prazo venceu, a aba foi fechada ou a página foi recarregada antes do retorno. O pedido continua salvo; confira a planilha e use **Reenviar pendentes**. A identificação impede duplicar uma guia já concluída.
- **Envio pausado — confira a falha:** pedidos seguintes aguardam a recuperação da falha. A pausa é preservada ao recarregar o sistema.
- **Envio automático desativado:** pedidos já na fila automática aguardam reativação ou envio manual.
- **Não enviado neste ambiente:** o pedido não foi enfileirado para a URL atual. Histórico antigo não entra automaticamente no novo destino.

O botão **Enviar / conferir selecionados** envia os pedidos escolhidos. Sem seleção, considera todo o histórico. Pedidos confirmados não são reenviados. **Reenviar pendentes** trata apenas a fila do ambiente atual. Ambos abrem a conexão Google, se necessário, e funcionam com o automático desativado.

Ao fechar/recarregar a página do sistema ou fechar a aba Google, será necessário conectar novamente. Novos pedidos salvos sem conexão ficam na fila local. Pedidos interrompidos exigem reenvio explícito. O sistema não abre pop-ups sozinho ao salvar, não tenta indefinidamente e não marca um pedido como confirmado apenas por iniciar uma solicitação.

## Localizar a planilha

Após conectar, a aba Google mostra **Abrir planilha** se já existe um destino; o sistema também recebe esse link, mesmo sem um novo envio. Se ainda não há planilha, o primeiro pedido confirmado a cria.

O link **Localizar planilha no Google**, disponível com uma URL configurada, abre uma consulta ao aplicativo. Essa consulta não cria uma planilha. Também é possível pesquisar **DropTech - Pedidos** no Drive da conta que implantou o aplicativo com **Executar como: Eu**. A conta do teste e a da DropTech podem ter planilhas diferentes.

As cópias do exportador antigo continuam no Drive. A planilha contínua fica registrada na propriedade `DROPTECH_SPREADSHEET_ID` do projeto. Se ela perder o acesso, o aplicativo mostra o erro e não cria silenciosamente outro destino.

## Consulta e PDF

A guia **Consulta de pedidos** tem filtros de Cliente, CNPJ, Data e outros campos. Abra o filtro e use a caixa de pesquisa. Marque **Selecionar** para conferir quantidade e valor dos pedidos escolhidos. Clique em **Abrir pedido** para acessar uma guia individual. Duas compras do mesmo cliente são pedidos distintos.

Cada guia inclui identificação, data, cliente, CNPJ, inscrição estadual, responsável, telefone, produtos, composição dos rolos, metragem, preços, desconto, pagamento e total. A seleção e os filtros são preservados nos próximos envios. Não apague a guia oculta **_DropTech controle**, que mantém a identificação dos pedidos e permite retomar envios parciais.

No histórico do sistema, clique em **PDF** no pedido e depois **Salvar em PDF**. O arquivo A4 é gerado e baixado diretamente, inclui apenas aquele pedido e funciona sem conexão ao Google. Pedidos com muitos itens são divididos em páginas, com cabeçalhos e numeração. A biblioteca usada fica na própria pasta do sistema, sem depender de uma CDN.

O botão separado **Imprimir** usa a janela de impressão do navegador. Se o navegador ou visualizador embutido não permitir essa janela, clique em **Salvar em PDF**, abra o arquivo baixado e imprima pelo leitor de PDF. Na janela de impressão do navegador, desative cabeçalhos e rodapés se desejar omitir URL e data.

## Histórico local e publicação

Os pedidos permanecem em `droptech_sales_v3`; a fila em `droptech_google_sync_v1`. A pausa e o link de cada destino são guardados em `droptech_google_paused_v1` e `droptech_google_destinations_v1`. Use o mesmo endereço e navegador em que salvou os pedidos. Trocar endereço/navegador ou limpar os dados pode impedir o acesso ao histórico local. A planilha mantém os pedidos confirmados; excluir um pedido local não o exclui do Google.

Para publicar o site, mantenha juntos `index.html`, `order-tools.js`, `order-pdf.js`, `google-sync.js`, `order-print.css` e a pasta `vendor` (biblioteca PDF e licença). A aplicação aceita até 100 pedidos por ação manual e até 500 itens por pedido. As correções de congelamento e dos separadores de fórmulas para a localidade brasileira continuam incluídas.

Referências: [Aplicativos da Web](https://developers.google.com/apps-script/guides/web), [comunicação nativa com o servidor](https://developers.google.com/apps-script/guides/html/communication), [restrições do serviço HTML](https://developers.google.com/apps-script/guides/html/restrictions) e [propriedades do projeto](https://developers.google.com/apps-script/reference/properties/properties-service).

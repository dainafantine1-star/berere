# Administração do Berêrê

O painel fica em `/admin` e exige acesso da equipe. O primeiro proprietário é criado em terminal interativo com `npm.cmd run owner:create`. Não existe senha padrão.

## Produtos e categorias

Cadastre nome, SKU, categoria, descrição, embalagem, unidade, preço, foto e estoque. Unidades disponíveis: kg, grama, unidade, maço, bandeja e pacote. Peso aceita até três casas decimais; embalagens contadas exigem quantidades inteiras.

Use a embalagem para informar, por exemplo, bandeja de 500 g ou pacote de seis unidades. Comprimento em milímetros e cobrança por medidas de construção foram retirados da gestão.

Promoção exige preço anterior maior que o atual. Destaque e promoção são independentes. Produtos sem preço podem permanecer sob consulta, mas não podem ser comprados pelo checkout enquanto o preço não for definido. Estoque zero bloqueia a compra.

Busca, filtros, paginação, duplicação, edição rápida e ações em lote continuam disponíveis. O sistema confere versões para impedir que uma alteração sobrescreva outra. Exclusões de cadastros preservam o histórico comercial.

Categorias têm nome, ordem, cor, descrição e imagem. Desativar uma categoria oculta seus produtos no app sem excluir os registros.

## Pedidos

Pedidos do app aparecem em **Pedidos e atendimentos**. Abra o pedido para conferir cliente, endereço, produtos, fotos, quantidades, preços preservados, frete e observações.

Retirada: recebido → em preparação → pronto para retirada → entregue. Entrega: recebido → em preparação → saiu para entrega → entregue. Cancelamento exige motivo; pedidos encerrados não podem ser reabertos pelo fluxo atual.

O checkout desconta estoque em transação no recebimento do pedido e impede duplicações por reenvio. Cancelar devolve o estoque uma única vez. O app apenas acompanha as etapas; a equipe controla a operação.

Atendimentos e orçamentos manuais continuam disponíveis para vendas negociadas. Eles têm fluxo próprio de aprovação e não reservam/baixam estoque automaticamente.

## Opções do app

Controle o recebimento de novos pedidos, retirada, entrega, taxa única, pedido mínimo e formas de pagamento. O sistema inicia com recebimento pausado para revisão do catálogo e dos dados comerciais.

Dinheiro, cartão e PIX registram a forma combinada. Não há cobrança online nem confirmação automática de recebimento.

O popup usa os produtos em promoção do catálogo. Configure ativação, tempo de espera e intervalo entre exibições. Vídeos são cadastrados por título, URL HTTPS e produto opcional.

## Imagens, campanhas e empresa

O upload aceita JPEG, PNG e WebP, com validação e otimização no servidor. A biblioteca permite reutilizar fotos; mídias vinculadas não são apagadas enquanto houver uso.

Banners têm conteúdo, imagem, destino, ordem e ativação. Dados da empresa alimentam logo, contato, endereço, horários e condições comerciais. O app atualiza dados periodicamente e ao recuperar o foco, sem exigir nova publicação para essas alterações.

## Planilhas

Em Produtos, baixe o modelo CSV atual antes de importar. A prévia mostra erros e o modo de criação/atualização; a aplicação é transacional e revalidada. O modelo usa categorias existentes e unidades do mercado.

A exportação WooCommerce continua disponível. Unidade e embalagem são atributos; os metadados específicos usam o prefixo `bereree_`. Ela não processa pagamentos nem cria regras de venda por peso no sistema de destino.

## Equipe, histórico e operação

O proprietário administra acessos. Administradores e editores têm permissões distintas, verificadas no servidor. Sessões usam cookies HttpOnly e proteção CSRF; revogação e desativação bloqueiam os acessos correspondentes.

O histórico registra alterações e responsáveis. Métricas e exportações ficam disponíveis conforme as permissões da equipe. Instalação e execução: [README.md](README.md). Backup e recuperação: [OPERACAO.md](OPERACAO.md).

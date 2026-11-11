# Berêrê — app e administração integrados

O app React do Berêrê usa uma API e uma administração compartilhadas. Catálogo, clientes e pedidos ficam em um banco compartilhado. O painel autenticado fica em `/admin`; o app do cliente fica em `/`.

## Executar

Na pasta principal deste projeto, com Node.js 24:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Abra `http://127.0.0.1:3000` para o app e `http://127.0.0.1:3000/admin` para a administração. A compilação já foi gerada no ambiente de desenvolvimento desta entrega.

Para criar o primeiro proprietário, em outro terminal interativo:

```powershell
npm.cmd run owner:create
```

O comando solicita e-mail e senha oculta. Não existe senha padrão nem cadastro público de administrador. As contas dos testes são criadas exclusivamente em bancos isolados e não dão acesso à loja.

O banco padrão é `storage/bereree.sqlite`. Mídias ficam em `storage/uploads`. O catálogo inicial contém os 30 produtos demonstrativos do app, com preços, descrições e imagens ainda sujeitos à revisão da empresa.

Novos pedidos começam **pausados**. No ADM, revise Produtos, Dados da empresa e Opções do app antes de ativar **Receber novos pedidos**. Entrega começa desativada; retirada está disponível para configuração. A ativação é persistida no banco.

## O que está integrado

- Catálogo, categorias, imagens, preços, promoções, destaques e disponibilidade controlados pelo ADM.
- Cadastro de clientes com senha e sessão HttpOnly; dados da conta disponíveis em outro dispositivo após login.
- Sessão de visitante, com pedido e histórico privados no navegador que possui o cookie. Ao entrar/criar conta, os dados dessa sessão visitante são associados à conta.
- Cesta, checkout, retirada/entrega, contato, observações, protocolo e snapshots de preço, código e foto.
- Cálculo de itens e frete no servidor; preço/estoque do navegador não são fonte de autoridade.
- Quantidades fracionadas para kg/g. Pacotes, bandejas e maços usam contagem inteira; a embalagem é informada no cadastro.
- Baixa de estoque transacional ao receber pedido; devolução ao cancelar; reenvio idempotente sem duplicação.
- Separação, pronto para retirada/saída para entrega, conclusão e cancelamento pelo ADM. O cliente apenas acompanha.
- Opções do app: pausa de pedidos, modalidades, taxa única de entrega, pedido mínimo, formas de pagamento, vídeos e popup de ofertas.
- Campanhas e popup usam conteúdo do servidor; preços do popup vêm dos produtos em promoção.
- Favoritos, listas de compras e endereços privados persistidos no servidor. Apenas cesta, indicação de boas-vindas e chave de tentativa são mantidas no armazenamento local do app.
- WhatsApp com resumo do pedido já registrado, sem envio automático de mensagens.
- Equipe, permissões, auditoria, importação/exportação CSV, imagens otimizadas, métricas, backup e restauração reaproveitados.
- PWA e instalação no celular preservados. O service worker não armazena respostas da API nem páginas administrativas.

O app consulta dados novamente a cada 30 segundos quando visível e ao recuperar o foco. O pedido sempre é revalidado no servidor.

Os antigos orçamentos manuais continuam disponíveis como atendimento separado. Eles mantêm seu fluxo de negociação e não baixam estoque; os pedidos criados pelo novo checkout têm fluxo próprio de estoque e entrega.

## Pagamentos e ampliações

Selecionar dinheiro, cartão ou PIX registra a forma combinada. Não há processamento online nem confirmação automática de pagamento. O mapa de endereços não representa GPS do entregador.

Continuam como ampliações: cobrança online e conciliação, frete por bairro, agendamento, ajuste por peso efetivo após separação, substituições, cupons, combos com composição de estoque, validade/perdas, notificações push, recuperação/verificação de e-mail e gestão financeira. O peso escolhido no checkout é a quantidade usada para preço e estoque nesta versão.

As imagens herdadas do app incluem materiais identificados como demonstrativos em `public/image-sources.json`. Use fotos próprias ou licenciadas antes da operação comercial. O catálogo inicial tem uma única fonte em `database/catalog.json`; as alterações da operação são feitas pelo ADM.

## Desenvolvimento e testes

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run check:app
npm.cmd run test:browsers
npm.cmd run check:performance
```

Os testes não usam o banco da loja. A suíte de servidor inclui a integração nova e os testes dos módulos de gestão, com dados de produtos de mercado em uma fixture isolada. A suíte de navegador usa Chromium desktop e celular Android emulado. Instalação de navegadores, se necessária: `npm.cmd run browsers:install`.

Para editar com Vite: mantenha `npm.cmd start` na porta 3000 e execute `npm.cmd run dev` em outro terminal. A API é encaminhada pelo proxy de desenvolvimento. Para avaliar a versão final, prefira a origem única na porta 3000 após compilar.

## Hospedagem

Esta integração precisa de Node.js 24, banco SQLite e uploads em disco persistente, em uma única instância. O Dockerfile compila o React e executa o backend; `render.yaml` prepara essa alternativa de hospedagem. Os modelos não criam nem contratam serviços automaticamente.

A publicação estática antiga na Vercel não executa esta API. Para manter esse provedor com arquitetura diferente, é necessário preparar o backend e armazenamento compatíveis antes da publicação. Não foi feita publicação nem alteração do repositório remoto nesta entrega.

Copie `.env.example` para `.env` quando precisar personalizar a configuração. Em produção, configure `PUBLIC_ORIGIN` com HTTPS, o armazenamento persistente, a chave de backup e o destino externo. Não use OneDrive para o banco de produção. Backups incluem banco e mídia; restauração revoga sessões de clientes e equipe. O arquivo restaurado se chama `store.sqlite`; aponte `DATABASE_PATH` para ele.

Verificações realizadas e limites de homologação: [VALIDACAO.md](VALIDACAO.md).

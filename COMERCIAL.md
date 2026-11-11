# Compra e atendimento do Berêrê

O app e a administração usam a mesma API e banco. O cliente consulta o catálogo publicado, organiza a cesta e escolhe retirada ou entrega conforme as opções habilitadas pela loja.

## Checkout

O cliente informa contato, endereço quando necessário, forma de pagamento e observações. O servidor confere produtos, quantidades, disponibilidade, preço, modalidade, frete e pedido mínimo. O total do navegador não determina o valor registrado.

O pedido e seus itens são gravados juntos. Nome, código, foto e preço dos produtos são preservados no momento da compra. Um reenvio da mesma tentativa devolve o pedido existente; outra compra precisa de uma nova tentativa.

Peso em kg/g admite frações. Unidade, maço, bandeja e pacote usam contagem inteira. Nesta versão, a quantidade escolhida determina preço e estoque; ajuste por pesagem final ainda não está implementado.

## Estoque e acompanhamento

Pedidos do checkout descontam estoque ao serem recebidos, sem permitir venda acima da disponibilidade. Cancelamento pela equipe devolve o estoque uma única vez.

Somente a equipe altera preparação, retirada/entrega e cancelamento. O cliente consulta seus próprios pedidos. Conta autenticada permite acesso em outro dispositivo; visitante depende da sessão privada daquele navegador.

## Atendimento manual

O ADM também permite registrar atendimentos e orçamentos para clientes cadastrados. Eles preservam itens, valores estimados, valor fechado, responsável e histórico. Aprovação transforma o registro em pedido negociado sem duplicá-lo. Esse fluxo manual não baixa nem reserva estoque automaticamente.

## Contato e pagamento

O resumo no WhatsApp é opcional: o pedido do checkout já está registrado no ADM. O sistema abre a conversa com o número configurado pela loja; o cliente confirma o envio no WhatsApp.

Selecionar uma forma de pagamento não representa cobrança online nem confirmação de recebimento. Frete por bairro, agendamento, pagamentos integrados e substituições de produtos são ampliações futuras.

Configurações e permissões do painel: [ADMIN.md](ADMIN.md).

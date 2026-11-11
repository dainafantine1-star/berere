# Validação — Berêrê — 29/10/2026

## Limpeza realizada

Removidos catálogo, página, imagens, estilos, scripts, documentação e testes exclusivos da madeireira. Removida a cópia duplicada do projeto e os arquivos gerados antigos. O banco antigo foi conferido antes da exclusão: não continha pedidos. Seus backups também foram identificados antes da remoção.

O banco storage/bereree.sqlite, seus backups, o catálogo atual com 30 produtos e 5 categorias e as funcionalidades compartilhadas de administração foram preservados. O histórico de migrações continua disponível para manter a compatibilidade do banco.

O ADM usa unidades de mercado; comprimento de madeira deixou de ser exposto. O catálogo inicial está em database/catalog.json; as vendas consultam o catálogo da API administrado pelo ADM.

## Verificações após a limpeza

| Verificação | Resultado |
|---|---|
| Compilação Vite | Passou |
| Catálogo, imagens, rotas e PWA | Passou |
| Servidor | 23 testes passaram |
| Componentes e estado do app | 16 de 17 passaram na rodada geral; os 4 testes de toque/instalação passaram na repetição isolada, incluindo aquele que havia excedido o tempo |
| Navegador no celular emulado | Fluxo completo passou, incluindo pedido, atendimento no ADM, foto e eventos |
| Navegador no computador | Tempo de espera excedido ao acessar como visitante; verificação não concluída |
| Verificação HTTP local | Passou; recursos atuais acessíveis e arquivos antigos removidos retornam 404 |
| Prévia local no Edge | Catálogo do Berêrê renderizado; captura automática excedeu a espera pelas fontes |
| Arquivos comprimidos | App JS: 105.818 bytes; CSS: 11.322 bytes; ADM JS: 29.086 bytes; dentro dos limites |

Os testes do servidor cobrem autenticação, permissões, quantidade fracionada, preço calculado no servidor, estoque, cancelamento, pedidos, importação, mídia, métricas, migração e restauração de backup. Os bancos dos testes são isolados da loja.

As falhas de tempo de espera da interface não comprovam a causa. A validação de navegador no computador permanece pendente; a compilação e os testes de servidor aprovados não substituem essa conferência.

## Limites

Não houve publicação, alteração do repositório remoto, cobrança online ou homologação em aparelho físico. Novos pedidos permanecem pausados no banco de operação até configuração pelo proprietário.

import {readFileSync} from 'node:fs';
export const {products,categories}=JSON.parse(readFileSync(new URL('../database/catalog.json',import.meta.url),'utf8'));
export const routes=['/instalar','/lista-compras','/videos','/admin','/','/boas-vindas','/login','/cadastro','/categorias','/produtos','/ofertas','/favoritos','/cesta','/checkout/endereco','/checkout/pagamento','/checkout/revisao','/pedido/acompanhamento','/pedidos','/perfil','/perfil/enderecos','/perfil/configuracoes','/gestao',...categories.map(c=>`/categoria/${c.id}`),...products.map(p=>`/produto/${p.id}`)];

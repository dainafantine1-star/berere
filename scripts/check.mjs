import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {products,categories,routes} from './catalog.mjs';
assert.equal(products.length,30);assert.equal(categories.length,5);
assert.equal(new Set(products.map(p=>p.id)).size,30);
for(const p of products){assert.ok(p.descricao.length>80);assert.ok(p.preco>0);assert.ok(categories.some(c=>c.id===p.categoria_id));assert.ok(existsSync('public'+p.imagem_url),p.id+' missing image');assert.ok(p.estoque>=0)}
for(const c of categories)assert.ok(existsSync('public'+c.icone_url));
for(const route of routes.filter(r=>r!=='/admin'&&r!=='/gestao'))assert.ok(existsSync('dist'+(route==='/'?'':route)+'/index.html'),route);
const manifest=JSON.parse(readFileSync('public/manifest.webmanifest'));for(const icon of manifest.icons)assert.ok(existsSync('public'+icon.src));assert.ok(existsSync('dist/sw.js'));assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');for(const icon of manifest.icons){const png=readFileSync('public'+icon.src);const size=Number(icon.sizes.split('x')[0]);assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size)}console.log(`PASS: 30 produtos, 5 categorias, imagens locais, ${routes.length} rotas diretas e arquivos PWA.`);

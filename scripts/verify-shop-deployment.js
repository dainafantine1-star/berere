import assert from 'node:assert/strict';
const origin=(process.env.PUBLIC_ORIGIN||'http://127.0.0.1:3000').replace(/\/$/,'');
for(const path of ['/api/health','/api/catalog','/','/produto/banana-prata','/perfil','/admin','/admin/app-settings.js','/manifest.webmanifest','/sw.js']){
 const response=await fetch(origin+path);assert.equal(response.status,200,path);if(path==='/api/catalog'){const data=await response.json();assert.ok(Array.isArray(data.products));assert.ok(data.app);}
}
for(const path of ['/api/admin/products','/api/admin/app-settings','/api/shop/data'])assert.equal((await fetch(origin+path)).status,401,path);
for(const path of ['/server/shop.js','/.env','/storage/bereree.sqlite','/database/catalog.json','/src/store.js','/package.json','/js/data.js','/index-madeireira.html','/assets/hero-madeira.webp','/catalog.json'])assert.equal((await fetch(origin+path)).status,404,path);
console.log('PASS: app, ADM, catálogo, PWA e proteção de dados na origem '+origin);

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {openDatabase} from '../server/db.js';
import {createApp} from '../server/index.js';
import {createAdmin} from '../server/auth.js';
import {createBackup,restoreBackup} from '../server/backup.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';

test('Berêrê: catálogo, contas, pedidos, estoque e operação pelo ADM',async t=>{
 const db=openDatabase(':memory:'),server=createApp({db});server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 const admin=createAdmin(db,{email:'equipe@example.test',password:'Senha-teste-isolada-123',role:'admin'});db.prepare('UPDATE admin_users SET is_owner=1 WHERE id=?').run(admin.id);
 function client(){let cookie='',csrf='';return {async req(path,method='GET',body,token=true){const response=await fetch(origin+'/api/'+path,{method,headers:{Cookie:cookie,Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'}),...(token&&csrf?{'X-CSRF-Token':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;return {status:response.status,data,cookie:response.headers.get('set-cookie')};}};}
 const staff=client(),a=client(),b=client();await a.req('shop/session');await b.req('shop/session');
 assert.equal((await staff.req('admin/login','POST',{email:'equipe@example.test',password:'Senha-teste-isolada-123',session:'cookie'})).status,200);
 await t.test('painel protegido, CSRF e cookies privados',async()=>{
  assert.equal((await b.req('admin/products')).status,401);
  assert.equal((await a.req('shop/preferences','PUT',{favorites:[],shoppingLists:[]},false)).status,403);
  const session=await client().req('shop/session');assert.match(session.cookie,/HttpOnly/);assert.match(session.cookie,/SameSite=Strict/);
  assert.equal((await fetch(origin+'/server/shop.js')).status,404);
  assert.equal((await fetch(origin+'/storage/bereree.sqlite')).status,404);
 });
 await t.test('catálogo recebe preço e estoque do ADM',async()=>{
  let catalog=(await a.req('catalog')).data;assert.equal(catalog.products.length,30);const p=catalog.products.find(p=>p.slug==='banana-prata');assert.equal(p.unit,'kg');
  assert.equal((await staff.req(`admin/products/${p.id}`,'PATCH',{price:10,oldPrice:null,stock:5,status:'active',version:p.version})).status,200);
  catalog=(await b.req('catalog')).data;assert.equal(catalog.products.find(x=>x.id===p.id).price,10);
  assert.ok((await staff.req('admin/audit')).data.items.length>0);
 });
 await t.test('opções do app têm versão e controlam recebimento',async()=>{
  const config=(await staff.req('admin/app-settings')).data;
  assert.equal((await a.req('shop/orders','POST',{requestKey:randomUUID(),mode:'retirada',payment:'dinheiro',items:[{id:1,qty:1}],customer:{nome:'Maria',telefone:'75999998888'}})).status,409);
  assert.equal((await staff.req('admin/app-settings','PUT',{...config,acceptingOrders:true,deliveryEnabled:true,deliveryFee:8,minimumOrder:0})).status,200);
  assert.equal((await staff.req('admin/app-settings','PUT',config)).status,409);
  assert.equal((await a.req('catalog')).data.app.deliveryFee,8);
 });
 let order,payload;
 await t.test('pedido fracionado recalcula preço e baixa estoque uma vez',async()=>{
  payload={requestKey:randomUUID(),mode:'retirada',payment:'dinheiro',customer:{nome:'Maria',telefone:'75999998888'},items:[{id:1,qty:.5}],total:0};
  const result=await a.req('shop/orders','POST',payload);assert.equal(result.status,200);order=result.data;assert.equal(order.total,5);assert.equal(order.items[0].quantidade,.5);assert.equal(order.items[0].preco_unitario,10);assert.equal(order.items[0].imagem_url,'/banana.png');
  assert.equal((await a.req('shop/orders','POST',payload)).data.id,order.id);assert.equal((await a.req('catalog')).data.products.find(x=>x.id===1).stock,4.5);
  assert.equal((await a.req('shop/orders','POST',{...payload,items:[{id:1,qty:1}]})).status,409);
  assert.equal((await b.req('shop/data')).data.orders.length,0);
  assert.equal((await b.req('shop/orders','POST',payload)).status,409);
 });
 await t.test('etapas só são alteradas pelo ADM e cancelamento devolve estoque',async()=>{
  assert.equal((await a.req(`admin/orders/${order.id}/delivery`,'PUT',{version:1,status:'cancelado',note:'Teste'})).status,401);
  let detail=(await staff.req(`admin/orders/${order.id}`)).data;
  assert.equal((await staff.req(`admin/orders/${order.id}`,'PUT',{version:detail.version,stage:'cancelled',note:'Teste'})).status,409);
  assert.equal((await staff.req(`admin/orders/${order.id}/delivery`,'PUT',{version:detail.version,status:'preparacao'})).status,200);
  assert.equal((await a.req('shop/data')).data.orders[0].status,'preparacao');
  detail=(await staff.req(`admin/orders/${order.id}`)).data;
  assert.equal((await staff.req(`admin/orders/${order.id}/delivery`,'PUT',{version:detail.version,status:'cancelado',note:'Cliente solicitou'})).status,200);
  assert.equal((await a.req('catalog')).data.products.find(x=>x.id===1).stock,5);
  assert.equal((await staff.req(`admin/orders/${order.id}/delivery`,'PUT',{version:detail.version+1,status:'cancelado',note:'Reenvio'})).status,409);
 });
 await t.test('compras concorrentes não ultrapassam o estoque e falha não grava pedido',async()=>{
  const p=(await a.req('catalog')).data.products.find(x=>x.id===1);await staff.req('admin/products/1','PATCH',{stock:1,version:p.version});
  const data={mode:'retirada',payment:'dinheiro',customer:{nome:'Maria',telefone:'75999998888'},items:[{id:1,qty:1}]};
  const results=await Promise.all([a.req('shop/orders','POST',{...data,requestKey:randomUUID()}),b.req('shop/orders','POST',{...data,requestKey:randomUUID()})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await a.req('catalog')).data.products.find(x=>x.id===1).stock,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n,2);
 });
 await t.test('conta assume somente a sessão visitante atual e funciona em outro dispositivo',async()=>{
  assert.equal((await a.req('shop/auth','POST',{register:true,nome:'Maria Silva',email:'maria@example.test',password:'Senha-cliente-12345'})).status,200);
  const login=client();await login.req('shop/session');assert.equal((await login.req('shop/auth','POST',{email:'maria@example.test',password:'Senha-cliente-12345'})).status,200);
  const mine=(await a.req('shop/data')).data;assert.ok(mine.orders.some(x=>x.id===order.id));assert.equal((await login.req('shop/data')).data.orders.length,mine.orders.length);
  const bad=client();await bad.req('shop/session');assert.equal((await bad.req('shop/auth','POST',{email:'maria@example.test',password:'incorreta'})).status,401);
  await a.req('shop/logout','POST',{});assert.equal((await a.req('shop/data')).status,401);await a.req('shop/session');assert.equal((await a.req('shop/data')).data.orders.length,0);
 });
 await t.test('endereços e listas ficam restritos ao dono',async()=>{
  const address=await b.req('shop/addresses','POST',{apelido:'Casa',nome:'Ana',telefone:'75999997777',rua:'Rua A',numero:'1',bairro:'Centro',cidade:'Itaberaba',cep:'46880-000'});assert.equal(address.status,200);
  await a.req('shop/addresses/'+address.data.id,'DELETE',{});assert.equal((await b.req('shop/data')).data.addresses.length,1);
  assert.equal((await b.req('shop/preferences','PUT',{favorites:['banana-prata'],shoppingLists:[{id:randomUUID(),nome:'Semana',data:new Date().toISOString(),items:[{product_id:'banana-prata',quantidade:.5}]}]})).status,200);
  assert.deepEqual((await a.req('shop/data')).data.favorites,[]);assert.deepEqual((await b.req('shop/data')).data.favorites,['banana-prata']);
 });
 await t.test('frete vem do ADM e não aceita valor informado pelo comprador',async()=>{
  const payload={requestKey:randomUUID(),mode:'entrega',payment:'dinheiro',customer:{nome:'Ana',telefone:'75999997777'},address:{apelido:'Casa',nome:'Ana',telefone:'75999997777',rua:'Rua A',numero:'1',bairro:'Centro',cidade:'Itaberaba',cep:'46880-000'},items:[{id:2,qty:1}],frete:0,total:.01};
  const result=await b.req('shop/orders','POST',payload);assert.equal(result.status,200);assert.equal(result.data.frete,8);assert.equal(result.data.total,16.9);
  assert.equal((await b.req('shop/orders','POST',{...payload,requestKey:randomUUID(),address:null})).status,400);
  assert.equal((await b.req('shop/orders','POST',{...payload,requestKey:randomUUID(),payment:'pix'})).status,409);
 });
 await t.test('backup restaura dados do app e revoga sessões de clientes e equipe',async()=>{
  const base=resolve('.cache'),directory=await mkdtemp(resolve(base,'shop-backup-'));
  try{const backup=await createBackup(db,{directory});const destination=resolve(directory,'restored');await restoreBackup(backup.file,destination);const restored=openDatabase(resolve(destination,'store.sqlite'));try{assert.ok(restored.prepare('SELECT count(*) AS n FROM orders').get().n>0);assert.ok(restored.prepare('SELECT count(*) AS n FROM shop_users').get().n>0);assert.equal(restored.prepare('SELECT count(*) AS n FROM shop_sessions').get().n,0);assert.equal(restored.prepare('SELECT count(*) AS n FROM admin_sessions').get().n,0);}finally{restored.close();}}
  finally{assert.ok(directory.startsWith(base+sep));await rm(directory,{recursive:true,force:true});}
 });
 await t.test('integridade relacional preservada',()=>{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);});
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database-fixture.js';
import { createApp } from '../server/index.js';
import { createOwner } from '../server/auth.js';

test('registered quotes, fractional lines, duplicate prevention, customers, transitions and campaigns',async(t)=>{
  const db=openDatabase(':memory:'),owner=createOwner(db,{email:'owner@example.com',password:'StrongPassword123'});
  const server=createApp({db});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();});let token;
  async function req(path,method='GET',data,authenticated=true){const response=await fetch(base+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(authenticated&&token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};}
  token=(await req('/api/admin/login','POST',{email:'owner@example.com',password:'StrongPassword123'})).data.token;
  assert.equal((await req('/api/admin/orders','GET',undefined,false)).status,401);
  assert.equal((await req('/api/quotes','POST',{requestKey:'no-contact-12345678',items:[{id:1,qty:1}]},false)).status,400);
  let p=(await req('/api/admin/products/1')).data;
  p=(await req('/api/admin/products/1','PUT',{...p,unit:'kg',stock:2.125,price:100.5,dimensions:'Por kg'})).data;assert.equal(p.stock,2.125);
  const input={requestKey:'fractional-request-1234',customer:{name:'Maria Cliente',phone:'(71) 98888-7777',email:'maria@example.com'},fulfillment:'delivery',deliveryAddress:'Rua da Feira, 10, Salvador',notes:'Selecionar frutas menos maduras.',items:[{id:1,qty:.5,lineKey:'L1',specifications:'Menos maduras'},{id:1,qty:1.125,lineKey:'L2',specifications:'Para consumo imediato'}]};
  const first=await req('/api/quotes','POST',input,false);assert.equal(first.status,201);assert.match(first.data.protocol,/^BER-\d{8}-[A-F0-9]{12}$/);assert.equal(first.data.knownSubtotal,163.31);assert.equal(first.data.registered,true);assert.match(first.data.message,/Menos maduras/);
  assert.equal((await req('/api/quotes','POST',{...input,customer:{...input.customer,phone:'5571988887777'}},false)).data.id,first.data.id);
  assert.equal((await req('/api/quotes','POST',{...input,notes:'Different'},false)).status,409);
  assert.equal((await req('/api/quotes','POST',{...input,requestKey:'over-stock-12345678',items:[{id:1,qty:1.5,lineKey:'A'},{id:1,qty:1,lineKey:'B'}]},false)).status,409);
  assert.equal((await req('/api/quotes','POST',{...input,requestKey:'bad-unit-12345678',items:[{id:2,qty:.5}]},false)).status,400);
  assert.equal((await req('/api/quotes','POST',{...input,requestKey:'bad-delivery-12345678',deliveryAddress:''},false)).status,400);
  let o=(await req('/api/admin/orders/'+first.data.id)).data;assert.equal(o.items.length,2);assert.equal(o.items[0].quantity,.5);assert.equal(o.customer.name,'Maria Cliente');assert.equal(o.history.length,1);
  assert.equal((await req('/api/admin/orders?q='+first.data.protocol)).data.total,1);
  let client=(await req('/api/admin/customers/'+o.customer_id)).data;assert.equal(client.orders.length,1);
  client=(await req('/api/admin/customers/'+client.id,'PUT',{...client,name:'Maria Revisada',notes:'Observação interna',document:'documento opcional'})).data;
  const publicAgain=await req('/api/quotes','POST',{...input,requestKey:'same-contact-other-123',customer:{...input.customer,name:'Nome informado no segundo envio'}},false);assert.equal(publicAgain.status,201);
  assert.equal((await req('/api/admin/customers/'+client.id)).data.name,'Maria Revisada');assert.equal((await req('/api/admin/customers/'+client.id)).data.notes,'Observação interna');assert.doesNotMatch(publicAgain.data.message,/Observação interna/);
  assert.equal((await req('/api/admin/customers','POST',{name:'Duplicado',phone:'71988887777'})).status,409);
  assert.equal((await req('/api/admin/customers?q=Maria')).data.total,1);
  assert.equal((await req('/api/admin/orders/'+o.id,'PUT',{version:o.version,stage:'completed',finalTotal:200,assignedTo:owner.id})).status,409);
  o=(await req('/api/admin/orders/'+o.id,'PUT',{version:o.version,stage:'in_progress',assignedTo:owner.id,note:'Atendimento iniciado'})).data;
  o=(await req('/api/admin/orders/'+o.id,'PUT',{version:o.version,stage:'awaiting_approval',finalTotal:200,note:'Proposta enviada'})).data;
  o=(await req('/api/admin/orders/'+o.id,'PUT',{version:o.version,stage:'approved',finalTotal:200,note:'Cliente aprovou'})).data;assert.equal(o.kind,'order');assert.equal(o.final_total_cents,20000);
  assert.equal((await req('/api/admin/orders/'+o.id,'PUT',{version:o.version,stage:'approved',finalTotal:250})).status,409);
  o=(await req('/api/admin/orders/'+o.id,'PUT',{version:o.version,stage:'completed',note:'Pedido entregue'})).data;assert.equal(o.stage,'completed');assert.ok(o.completed_at);assert.equal(o.history.length,5);
  assert.equal((await req('/api/admin/orders/'+o.id,'PUT',{version:o.version,stage:'in_progress'})).status,409);
  let second=(await req('/api/admin/orders/'+publicAgain.data.id)).data;
  assert.equal((await req('/api/admin/orders/'+second.id,'PUT',{version:second.version,stage:'cancelled'})).status,400);
  second=(await req('/api/admin/orders/'+second.id,'PUT',{version:second.version,stage:'cancelled',note:'Cliente adiou a compra'})).data;assert.equal(second.stage,'cancelled');
  const config=(await req('/api/admin/settings')).data;
  const changed=await req('/api/admin/settings','PUT',{...config,name:'Berêrê Teste',maxQuoteQuantity:2,stockZeroBehavior:'hide',defaultLowStock:7,whatsappMessage:'Mensagem configurada',heroTitle:'Headline de teste',benefits:[{title:'Atendimento',text:'Conte com a equipe'}],secret:'not public'});assert.equal(changed.status,200);assert.equal(changed.data.secret,undefined);
  assert.equal((await req('/api/admin/settings','PUT',config)).status,409);
  p=(await req('/api/admin/products/1','PATCH',{stock:0,version:p.version})).data;assert.equal((await req('/api/catalog')).data.products.some(p=>p.id===1),false);
  const banner=await req('/api/admin/banners','POST',{title:'Campanha',body:'Texto seguro',tag:'NOVIDADE',cta:'Ver promoções',destination:'#promocoes',sortOrder:0,active:true,image:'/banana.png'});assert.equal(banner.status,201);
  assert.equal((await req('/api/catalog')).data.banners.some(b=>b.id===banner.data.id),true);
  assert.equal((await req('/api/admin/banners','PUT',{})).status,404);
  assert.equal((await req('/api/admin/banners/'+banner.data.id,'PUT',{...banner.data,destination:'javascript:alert(1)',active:true})).status,400);
  assert.equal((await req('/api/admin/banners/'+banner.data.id,'PUT',{...banner.data,active:false})).status,200);assert.equal((await req('/api/catalog')).data.banners.some(b=>b.id===banner.data.id),false);
  assert.equal((await req('/api/admin/customers/'+client.id)).data.orders.length,2);
});

test('migration preserves populated version-2 customers, stock, orders and item snapshots',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bereree-v2-')),path=join(dir,'store.sqlite');
  let db;
  try {
    db=new DatabaseSync(path);db.exec(readFileSync(new URL('../server/migrations/001-initial.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../server/migrations/002-management.sql',import.meta.url),'utf8'));
    db.exec("CREATE TABLE migrations(name TEXT PRIMARY KEY,applied_at TEXT DEFAULT CURRENT_TIMESTAMP);INSERT INTO migrations(name) VALUES('001-initial.sql'),('002-management.sql');INSERT INTO categories(id,label,slug) VALUES('frutas','Frutas','frutas');INSERT INTO products(id,reference,sku,name,category_id,price_cents,stock) VALUES(1,'OLD','OLD','Produto anterior','frutas',1000,2);INSERT INTO customers(id,name,phone) VALUES(1,'Cliente anterior','71988887777');INSERT INTO company_settings(id,public_json) VALUES(1,'{}');INSERT INTO orders(id,request_key,customer_id,kind,known_total_cents,has_consultation,terms_snapshot) VALUES('old-order','old-key',1,'quote',1000,0,'Condição anterior');INSERT INTO order_items(order_id,product_id,reference_snapshot,name_snapshot,specs_snapshot,terms_snapshot,unit_price_cents,quantity) VALUES('old-order',1,'OLD','Nome original','{}','Termo original',1000,1);");db.close();
    db=openDatabase(path);assert.equal(db.prepare('SELECT quantity FROM order_items').get().quantity,1);assert.equal(db.prepare('SELECT stock_milli FROM products').get().stock_milli,2000);assert.equal(JSON.parse(db.prepare('SELECT customer_snapshot FROM orders').get().customer_snapshot).name,'Cliente anterior');assert.equal(db.prepare('SELECT count(*) AS n FROM order_history').get().n,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
    db=openDatabase(path);assert.equal(db.prepare('SELECT count(*) AS n FROM order_items').get().n,1);db.close();
  }finally{if(db?.isOpen)db.close();assert.equal(resolve(dirname(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

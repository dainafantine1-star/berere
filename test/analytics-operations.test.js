import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,dirname } from 'node:path';
import { once } from 'node:events';
import sharp from 'sharp';
import { openDatabase } from './database-fixture.js';
import { createOwner,createAdmin,login } from '../server/auth.js';
import { recordEvent,metrics,period,snapshot,reportCSV } from '../server/analytics.js';
import { uploadImage } from '../server/media.js';
import { createBackup,restoreBackup } from '../server/backup.js';
import { createApp } from '../server/index.js';
import { createQuote,updateOrder,orderDetail } from '../server/orders.js';
import { clientAddress } from '../server/client-address.js';

test('analytics: deduplication, historical attribution, Bahia boundary, real comparisons and missing days',t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());const sessionKey=randomUUID();
  db.prepare("UPDATE products SET featured=1,status='promotion',price_cents=100,old_price_cents=200 WHERE id=1").run();
  const input={name:'product_view',productId:1,origin:'catalog_card',eventKey:randomUUID(),sessionKey};
  assert.equal(recordEvent(db,input,new Date('2026-10-20T02:59:59Z')).duplicate,false);
  assert.equal(recordEvent(db,input,new Date('2026-10-20T03:00:00Z')).duplicate,true);
  assert.equal(recordEvent(db,{...input,eventKey:randomUUID(),origin:'featured_card'},new Date('2026-10-20T03:01:00Z')).duplicate,true);
  const click={name:'whatsapp_click',productIds:[1,2,1],origin:'quote_continue',eventKey:randomUUID(),sessionKey};
  assert.equal(recordEvent(db,click,new Date('2026-10-20T04:00:00Z')).duplicate,false);
  const repeat={...click,eventKey:randomUUID()};
  assert.equal(recordEvent(db,repeat,new Date('2026-10-20T04:00:01Z')).duplicate,true);
  assert.equal(recordEvent(db,repeat,new Date('2026-10-20T04:01:00Z')).duplicate,true);
  db.prepare("UPDATE products SET featured=0,status='active',name='Alterado' WHERE id=1").run();
  snapshot(db,new Date('2026-10-20T12:00:00Z'));
  const query=new URLSearchParams({start:'2026-10-19',end:'2026-10-21'}),data=metrics(db,query,new Date('2026-10-21T12:00:00Z'));
  assert.equal(data.range.start,'2026-10-19T03:00:00.000Z');assert.equal(data.kpis.views.current,1);assert.equal(data.kpis.clicks.current,1);assert.equal(data.kpis.clicks.growth,null);
  assert.equal(data.products.reduce((n,p)=>n+p.clicks,0),2);assert.equal(data.products.find(p=>p.id===1).featuredClicks,1);assert.equal(data.products.find(p=>p.id===1).promotionClicks,1);assert.notEqual(data.products.find(p=>p.id===1).name,'Alterado');
  assert.equal(data.daily[0].activeProducts,null);assert.equal(data.daily[1].activeProducts,30);assert.equal(data.daily[2].orders,0);
  const nextDay=metrics(db,new URLSearchParams({start:'2026-10-20',end:'2026-10-20'}),new Date('2026-10-21T12:00:00Z'));assert.equal(nextDay.kpis.views.current,0);
  assert.match(reportCSV(data,'clicks'),/quote_continue/);assert.throws(()=>period(new URLSearchParams({start:'2025-01-01',end:'2026-10-20'})),/366/);assert.throws(()=>period(new URLSearchParams({end:'2026-02-30'})),/inválida/);
});

test('backup: encrypted database/media, authenticated corruption detection and full isolated recovery',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'bereree-recovery-')),priorUploads=process.env.UPLOAD_DIR;process.env.UPLOAD_DIR=join(directory,'media');
  const db=openDatabase(join(directory,'live.sqlite'));const key=randomBytes(32).toString('base64');
  t.after(async()=>{db.close();if(priorUploads===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=priorUploads;assert.equal(resolve(dirname(directory)),resolve(tmpdir()));await rm(directory,{recursive:true,force:true});});
  const user=createOwner(db,{email:'recovery@example.com',password:'StrongPassword123'});
  const data=await sharp({create:{width:1000,height:600,channels:3,background:'#915d32'}}).png().toBuffer();
  const image=await uploadImage(db,user,{name:'test.png',type:'image/png',data:data.toString('base64')});
  db.prepare('UPDATE products SET image=?,name=? WHERE id=1').run(image.url,'Restaurado');
  const quote=createQuote(db,{requestKey:randomUUID(),items:[{id:1,qty:1,specifications:'Frutas menos maduras'}],customer:{name:'Cliente Recuperado',phone:'71977776666'}});
  const original=orderDetail(db,quote.id);updateOrder(db,user,quote.id,{version:original.version,stage:'in_progress',note:'Histórico a preservar'});
  login(db,{email:'recovery@example.com',password:'StrongPassword123'});
  const archive=await createBackup(db,{directory:join(directory,'backups'),uploads:process.env.UPLOAD_DIR,key});assert.equal(archive.encrypted,true);assert.equal(archive.files,5);
  assert.equal((await readFile(archive.file)).includes(Buffer.from('recovery@example.com')),false);
  await assert.rejects(restoreBackup(archive.file,join(directory,'bad'),{key:randomBytes(32).toString('base64')}));
  const broken=Buffer.from(await readFile(archive.file));broken[broken.length-3]^=1;await writeFile(join(directory,'broken.mpbackup'),broken);
  await assert.rejects(restoreBackup(join(directory,'broken.mpbackup'),join(directory,'broken'),{key}));
  const recovered=await restoreBackup(archive.file,join(directory,'restored'),{key});assert.equal(recovered.sessionsRevoked,true);
  await assert.rejects(restoreBackup(archive.file,join(directory,'restored'),{key}),/inexistente/);
  const restored=openDatabase(join(directory,'restored/store.sqlite'));
  assert.equal(restored.prepare('SELECT name FROM products WHERE id=1').get().name,'Restaurado');assert.equal(restored.prepare('SELECT count(*) AS n FROM admin_sessions').get().n,0);assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const recoveredQuote=orderDetail(restored,quote.id);assert.equal(recoveredQuote.stage,'in_progress');assert.equal(recoveredQuote.items[0].custom_specs,'Frutas menos maduras');assert.equal(recoveredQuote.customer.name,'Cliente Recuperado');assert.equal(recoveredQuote.history.length,2);assert.equal(restored.prepare('SELECT count(*) AS n FROM audit_log').get().n,db.prepare('SELECT count(*) AS n FROM audit_log').get().n);
  assert.deepEqual(await readFile(join(directory,'restored',image.url)),await readFile(join(directory,'media',image.url.slice(8))));
  process.env.UPLOAD_DIR=join(directory,'restored/uploads');
  const app=createApp({db:restored});app.listen(0,'127.0.0.1');await once(app,'listening');const base=`http://127.0.0.1:${app.address().port}`;
  try{assert.equal((await fetch(base+'/api/health')).status,200);assert.equal((await fetch(base+'/'+image.url.replace('.webp','-320.webp'))).status,200);const response=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'recovery@example.com',password:'StrongPassword123'})});assert.equal(response.status,200);}finally{app.closeAllConnections();await new Promise(r=>app.close(r));restored.close();}
});

test('metrics endpoints enforce permissions, CSV safety and asset cache revalidation',async t=>{
  const db=openDatabase(':memory:');createAdmin(db,{email:'editor@example.com',password:'StrongPassword123',role:'editor'});createOwner(db,{email:'owner@example.com',password:'StrongPassword123'});
  const app=createApp({db});app.listen(0,'127.0.0.1');await once(app,'listening');const base=`http://127.0.0.1:${app.address().port}`;t.after(async()=>{app.closeAllConnections();await new Promise(r=>app.close(r));db.close();});
  assert.equal((await fetch(base+'/api/admin/metrics')).status,401);
  const auth=login(db,{email:'editor@example.com',password:'StrongPassword123'});assert.equal((await fetch(base+'/api/admin/metrics',{headers:{Authorization:'Bearer '+auth.token}})).status,403);
  const owner=login(db,{email:'owner@example.com',password:'StrongPassword123'});assert.equal((await fetch(base+'/api/admin/metrics',{headers:{Authorization:'Bearer '+owner.token}})).status,200);
  const page=await fetch(base+'/');assert.ok(page.headers.get('etag'));assert.equal((await fetch(base+'/',{headers:{'If-None-Match':page.headers.get('etag')}})).status,304);
  assert.match(reportCSV({products:[{id:1,name:'=FORMULA'}]},'products'),/'=FORMULA/);
});

test('forwarded IP is accepted only from the configured proxy and from its last entry',()=>{
  const req={socket:{remoteAddress:'::ffff:172.29.253.2'},headers:{'x-forwarded-for':'1.2.3.4, 5.6.7.8'}};
  assert.equal(clientAddress(req),'172.29.253.2');assert.equal(clientAddress(req,'172.29.253.2'),'5.6.7.8');assert.equal(clientAddress(req,'127.0.0.1'),'172.29.253.2');req.headers['x-forwarded-for']='invalid';assert.equal(clientAddress(req,'172.29.253.2'),'172.29.253.2');
});

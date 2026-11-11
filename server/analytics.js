import { createHash } from 'node:crypto';
import { transaction } from './db.js';
import * as v from './validation.js';

export const timezone='America/Bahia';
const DAY=86400000;
export const localDay=date=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const stamp=date=>date.toISOString().replace('T',' ').slice(0,19);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const origins=['storefront','header','floating','contact','catalog_card','featured_card','product_detail','quote_continue'];

export function recordEvent(db,input,now=new Date()) {
  v.check(['catalog_view','product_view','whatsapp_click'].includes(input.name),'Evento inválido.');
  v.check(uuid(input.eventKey)&&uuid(input.sessionKey),'Identificador de evento inválido.');
  v.check(origins.includes(input.origin),'Origem de evento inválida.');
  const ids=input.productIds ?? (input.productId===undefined?[]:[input.productId]);
  v.check(Array.isArray(ids)&&ids.length<=100,'Produtos inválidos.');
  ids.forEach(id=>v.integer(id));
  const unique=[...new Set(ids)].sort((a,b)=>a-b);
  v.check(input.name!=='product_view'||unique.length===1,'Informe um produto.');
  v.check(input.name!=='catalog_view'||!unique.length,'Evento de catálogo inválido.');
  const products=unique.map(id=>{const p=db.prepare('SELECT p.*,c.label AS category_label FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=?').get(id);v.check(p,'Produto inexistente.');return p;});
  const key=createHash('sha256').update(JSON.stringify([input.sessionKey,input.name,input.name==='product_view'?'':input.origin,unique])).digest('hex');
  return transaction(db,()=>{
    const reused=db.prepare('SELECT event_id AS id FROM event_receipts WHERE event_key=? UNION SELECT id FROM events WHERE event_key=?').get(input.eventKey,input.eventKey);
    if(reused)return {ok:true,duplicate:true};
    const previous=db.prepare('SELECT * FROM event_dedup WHERE key=?').get(key);
    const windowMs=input.name==='whatsapp_click'?2000:1800000;
    if(previous&&now.getTime()-Date.parse(previous.seen_at+'Z')<windowMs){db.prepare('INSERT INTO event_receipts VALUES(?,?)').run(input.eventKey,previous.event_id);return {ok:true,duplicate:true};}
    const id=Number(db.prepare('INSERT INTO events(name,product_id,event_key,origin,created_at) VALUES(?,?,?,?,?)').run(input.name,unique.length===1?unique[0]:null,input.eventKey,input.origin,stamp(now)).lastInsertRowid);
    const insert=db.prepare('INSERT INTO event_products VALUES(?,?,?,?,?,?,?)');
    db.prepare('INSERT INTO event_receipts VALUES(?,?)').run(input.eventKey,id);
    for(const p of products)insert.run(id,p.id,p.name,p.category_id,p.category_label,p.featured,p.status==='promotion'&&p.price_cents!==null&&p.old_price_cents>p.price_cents?1:0);
    db.prepare('INSERT INTO event_dedup VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET event_id=excluded.event_id,seen_at=excluded.seen_at').run(key,id,stamp(now));
    db.prepare("DELETE FROM event_dedup WHERE seen_at<datetime(?,'-2 days')").run(stamp(now));
    return {ok:true,duplicate:false};
  });
}

export function snapshot(db,now=new Date()) {
  const counts=db.prepare(`SELECT count(*) AS active_products,coalesce(sum(p.featured),0) AS featured,coalesce(sum(p.status='promotion' AND p.price_cents IS NOT NULL AND p.old_price_cents>p.price_cents),0) AS promotions FROM products p JOIN categories c ON c.id=p.category_id WHERE p.deleted_at IS NULL AND p.active=1 AND c.active=1`).get();
  const categories=db.prepare('SELECT count(*) AS n FROM categories WHERE active=1').get().n;
  db.prepare('INSERT INTO catalog_daily VALUES(?,?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET captured_at=excluded.captured_at,active_products=excluded.active_products,categories=excluded.categories,featured=excluded.featured,promotions=excluded.promotions').run(localDay(now),stamp(now),counts.active_products,categories,counts.featured,counts.promotions);
  return {...counts,categories,capturedAt:now.toISOString()};
}

export function period(params,now=new Date()) {
  const today=localDay(now),days=v.integer(Number(params.get('days')||30),1,366);
  const endDay=params.get('end')||today;
  const valid=s=>/^20\d\d-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  v.check(valid(endDay)&&endDay<=today,'Data final inválida.');
  const startDay=params.get('start')||new Date(Date.parse(endDay)-(days-1)*DAY).toISOString().slice(0,10);
  v.check(valid(startDay)&&startDay<=endDay&&startDay>='2020-01-01','Data inicial inválida (mínimo 01/01/2020).');
  // Bahia uses UTC-03 throughout the supported period (2020 onward).
  const start=new Date(startDay+'T03:00:00Z'),calendarEnd=new Date(Date.parse(endDay+'T03:00:00Z')+DAY);
  const n=Math.round((calendarEnd-start)/DAY);v.check(n<=366,'Escolha até 366 dias.');
  const end=new Date(Math.min(calendarEnd.getTime(),now.getTime()));
  const previousStart=new Date(start.getTime()-n*DAY),previousEnd=new Date(previousStart.getTime()+(end-start));
  return {timezone,startDay,endDay,days:n,start:start.toISOString(),end:end.toISOString(),previousStart:previousStart.toISOString(),previousEnd:previousEnd.toISOString(),partial:end<calendarEnd};
}

const change=(current,previous)=>({current,previous,growth:previous===0?null:Math.round((current-previous)/previous*10000)/100});
export function metrics(db,params=new URLSearchParams(),now=new Date()) {
  const range=period(params,now),bounds=[stamp(new Date(range.start)),stamp(new Date(range.end))],prior=[stamp(new Date(range.previousStart)),stamp(new Date(range.previousEnd))];
  const count=(table,where,b)=>db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where} AND created_at>=? AND created_at<?`).get(...b).n;
  const kpis={};
  for(const [key,name]of [['views','product_view'],['clicks','whatsapp_click']])kpis[key]=change(count('events',`name='${name}'`,bounds),count('events',`name='${name}'`,prior));
  kpis.orders=change(count('orders','1=1',bounds),count('orders','1=1',prior));
  const productRows=db.prepare(`WITH observed AS (SELECT ep.*,e.name AS event_name,row_number() OVER(PARTITION BY ep.product_id ORDER BY e.created_at DESC,e.id DESC) AS rank FROM events e JOIN event_products ep ON ep.event_id=e.id WHERE e.created_at>=? AND e.created_at<?) SELECT product_id AS id,max(CASE WHEN rank=1 THEN product_name END) AS name,max(CASE WHEN rank=1 THEN category_label END) AS category,sum(event_name='product_view') AS views,sum(event_name='whatsapp_click') AS clicks,sum(event_name='whatsapp_click' AND featured=1) AS featuredClicks,sum(event_name='whatsapp_click' AND promotion=1) AS promotionClicks FROM observed GROUP BY product_id ORDER BY views DESC,clicks DESC,product_id`).all(...bounds);
  const categories=db.prepare(`WITH observed AS (SELECT ep.*,e.name AS event_name,row_number() OVER(PARTITION BY ep.category_id ORDER BY e.created_at DESC,e.id DESC) AS rank FROM events e JOIN event_products ep ON ep.event_id=e.id WHERE e.created_at>=? AND e.created_at<?) SELECT category_id AS id,max(CASE WHEN rank=1 THEN category_label END) AS name,sum(event_name='product_view') AS views,sum(event_name='whatsapp_click') AS clicks FROM observed GROUP BY category_id ORDER BY clicks DESC,views DESC`).all(...bounds);
  const origins=db.prepare(`SELECT origin,count(*) AS clicks FROM events WHERE name='whatsapp_click' AND created_at>=? AND created_at<? GROUP BY origin ORDER BY clicks DESC`).all(...bounds);
  const clicks=db.prepare(`SELECT date(e.created_at,'-3 hours') AS day,e.origin,ep.product_id AS id,coalesce(ep.product_name,'Sem produto atribuído') AS name,count(*) AS clicks FROM events e LEFT JOIN event_products ep ON ep.event_id=e.id WHERE e.name='whatsapp_click' AND e.created_at>=? AND e.created_at<? GROUP BY day,e.origin,ep.product_id,ep.product_name ORDER BY day DESC,clicks DESC`).all(...bounds);
  const stages=db.prepare('SELECT stage,count(*) AS total FROM orders WHERE created_at>=? AND created_at<? GROUP BY stage ORDER BY stage').all(...bounds);
  const dailyOrders=new Map(db.prepare("SELECT date(created_at,'-3 hours') AS day,count(*) AS n FROM orders WHERE created_at>=? AND created_at<? GROUP BY day").all(...bounds).map(r=>[r.day,r.n]));
  const dailySnapshots=new Map(db.prepare('SELECT * FROM catalog_daily WHERE day>=? AND day<=? ORDER BY day').all(range.startDay,range.endDay).map(r=>[r.day,r]));
  const daily=Array.from({length:range.days},(_,i)=>{const day=new Date(Date.parse(range.startDay)+i*DAY).toISOString().slice(0,10),s=dailySnapshots.get(day);return {day,orders:dailyOrders.get(day)||0,activeProducts:s?.active_products??null,capturedAt:s?.captured_at??null};});
  const stock=db.prepare(`SELECT p.id,p.name,p.sku,p.stock_milli/1000.0 AS stock,p.low_stock AS lowStock,p.unit,c.label AS category,p.active,p.status FROM products p JOIN categories c ON c.id=p.category_id WHERE p.deleted_at IS NULL AND p.stock_milli IS NOT NULL AND (p.stock_milli=0 OR p.stock_milli<=p.low_stock*1000) ORDER BY p.stock_milli,p.name`).all();
  const current=snapshot(db,now);
  // Refresh today's point after capturing, without inventing previous observations.
  const point=daily.find(d=>d.day===localDay(now));if(point){point.activeProducts=current.active_products;point.capturedAt=stamp(now);}
  const collectionStarted=db.prepare("SELECT applied_at FROM migrations WHERE name='004_analytics.sql'").get()?.applied_at??null;
  const unattributed=db.prepare(`SELECT count(*) AS n FROM events e WHERE e.name='product_view' AND e.created_at>=? AND e.created_at<? AND NOT EXISTS(SELECT 1 FROM event_products ep WHERE ep.event_id=e.id)`).get(...bounds).n;
  return {range,current,kpis,daily,products:productRows,categories,origins,clicks,stages,stock,collectionStarted,legacyViews:unattributed};
}

export function reportCSV(data,type) {
  const reports={products:['id','name','category','views','clicks','featuredClicks','promotionClicks'],origins:['origin','clicks'],clicks:['day','origin','id','name','clicks'],categories:['id','name','views','clicks'],stages:['stage','total'],stock:['id','name','sku','category','stock','lowStock','unit'],daily:['day','orders','activeProducts','capturedAt']};
  v.check(Object.hasOwn(reports,type),'Relatório inexistente.');
  const columns=reports[type];const cell=value=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';
  return '\ufeff'+[columns,...data[type].map(r=>columns.map(c=>r[c]))].map(row=>row.map(cell).join(',')).join('\r\n');
}

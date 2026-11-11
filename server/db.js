import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaults } from './settings-defaults.js';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function openDatabase(path = process.env.DATABASE_PATH || resolve(root, 'storage/bereree.sqlite')) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of readdirSync(new URL('./migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) {
    if (!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(name)) transaction(db, () => {
      db.exec(readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8'));
      db.prepare('INSERT INTO migrations(name) VALUES(?)').run(name);
    });
  }
  if (!db.prepare('SELECT 1 FROM company_settings').get()) seed(db);
  return db;
}
function seed(db) {
  // The original catalog is used only for the first migration; subsequent edits use the API.
  const {products,categories}=JSON.parse(readFileSync(resolve(root,'database/catalog.json'),'utf8'));
  transaction(db, () => {
    for (const c of categories) db.prepare('INSERT INTO categories(id,label,slug,image,color,description) VALUES(?,?,?,?,?,?)').run(c.id,c.nome,c.id,c.icone_url,c.cor,c.descricao);
    products.forEach((p,i)=>{const sku=p.codigo||`BER-${String(i+1).padStart(4,'0')}`;db.prepare(`INSERT INTO products(reference,name,category_id,price_cents,old_price_cents,description,image,sku,slug,unit,dimensions,status,stock,stock_milli,featured) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sku,p.nome,p.categoria_id,Math.round(p.preco*100),p.oferta&&p.preco_anterior>p.preco?Math.round(p.preco_anterior*100):null,p.descricao,p.imagem_url,sku,p.id,p.unidade==='1 kg'?'kg':p.unidade.includes('maço')?'maco':p.unidade.includes('Bandeja')?'bandeja':'un',p.unidade,p.oferta&&p.preco_anterior>p.preco?'promotion':'active',p.estoque,p.estoque*1000,Number(i<6));});
    db.prepare('INSERT INTO company_settings(id,public_json) VALUES(1,?)').run(JSON.stringify({
      name:'Berêrê',whatsapp:'',phone:'A confirmar',address:'Rua Alfredo Hayne, 88 — Itaberaba, BA',
      hours:'Horários a confirmar',confirmed:false,
      delivery:'Prazo, região atendida e frete sob consulta.', payment:'Formas de pagamento e parcelamento sob consulta.',
      commercialTerms:'Preços provisórios. Descontos, disponibilidade, frete, prazo e pagamento sujeitos à confirmação.'
    }));
    const banners = [
      ['CATÁLOGO','Frescor para sua mesa','Conheça os produtos do Berêrê.'],
      ['OFERTAS','Sua feira com mais cor','Confira os produtos e as ofertas do catálogo.']
    ];
    banners.forEach((b,i) => db.prepare('INSERT INTO banners(tag,title,body,sort_order,destination,cta) VALUES(?,?,?,?,?,?)').run(...b,i,i?'/ofertas':'/produtos','Ver produtos'));
  });
}
export function settings(db) { const row=db.prepare('SELECT public_json,version FROM company_settings WHERE id=1').get();return {...defaults,...JSON.parse(row.public_json),version:row.version}; }
export function productDTO(row) {
  return { id:row.id,slug:row.slug||`produto-${row.id}`, reference:row.reference, name:row.name, category:row.category_id, categoryLabel:row.category_label,
    price:row.price_cents === null ? null : row.price_cents/100, oldPrice:row.old_price_cents === null ? null : row.old_price_cents/100,
    offer:row.status==='promotion' && row.old_price_cents !== null && row.price_cents !== null, description:row.description, specs:JSON.parse(row.specs_json),
    image:row.image, commercialTerms:row.commercial_terms, active:!!row.active,sku:row.sku,dimensions:row.dimensions,
    unit:row.unit,status:row.status,featured:!!row.featured,stock:row.stock_milli==null?null:row.stock_milli/1000,lowStock:row.low_stock,version:row.version,
    categoryActive:row.category_active!==0,available:!!row.active && row.category_active!==0 && row.status!=='unavailable' && row.stock_milli!==0 };
}
export function catalog(db) {
  const company=settings(db);
  return { products:db.prepare('SELECT p.*, c.label AS category_label FROM products p JOIN categories c ON c.id=p.category_id WHERE p.active=1 AND p.deleted_at IS NULL AND c.active=1 ORDER BY p.featured DESC,p.id').all().filter(p=>company.stockZeroBehavior!=='hide'||p.stock_milli!==0).map(productDTO),
    categories:db.prepare('SELECT id,label,slug,image,icon,sort_order,color,description FROM categories WHERE active=1 ORDER BY sort_order,id').all(),
    media:db.prepare('SELECT m.filename,m.width AS original_width,v.width FROM media m LEFT JOIN media_variants v ON v.media_id=m.id ORDER BY m.filename,v.width').all(),
    banners:db.prepare('SELECT id,tag,title,body,image,cta,destination FROM banners WHERE active=1 ORDER BY sort_order,id').all(), settings:company };
}

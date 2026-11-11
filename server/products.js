import * as v from './validation.js';
import { productDTO, transaction,settings } from './db.js';
import { quantity } from './orders.js';
import { audit } from './audit.js';

export const productSelect='SELECT p.*,c.label AS category_label,c.active AS category_active FROM products p JOIN categories c ON c.id=p.category_id';
export function getProduct(db,id) {const p=db.prepare(`${productSelect} WHERE p.id=? AND p.deleted_at IS NULL`).get(v.integer(id));v.check(p,'Produto inexistente.',404);return p;}
export function validateProduct(db,p) {
  const category=v.slug(p.category);v.check(db.prepare('SELECT 1 FROM categories WHERE id=?').get(category),'Categoria inexistente.');
  const price=v.money(p.price),old=v.money(p.oldPrice ?? null);
  v.check(old===null || (price!==null && old>price),'O preço anterior deve ser maior que o atual.');
  const status=p.status || (old!==null?'promotion':'active');v.check(['active','promotion','unavailable'].includes(status),'Status inválido.');
  v.check(status!=='promotion' || (price!==null && old!==null),'Promoção exige preço atual e preço anterior.');
  const sku=v.text(p.sku ?? p.reference,80);v.check(/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(sku),'SKU aceita letras, números, ponto, hífen e sublinhado.');
  const unit=p.unit || 'un';v.check(['un','kg','g','maco','bandeja','pacote'].includes(unit),'Unidade inválida.');
  const image=v.image(p.image || '');
  const stock=p.stock==null?null:p.stock===0?0:quantity(p.stock,unit,100000000);
  if(image.startsWith('uploads/')) v.check(db.prepare('SELECT 1 FROM media WHERE filename=?').get(image.slice(8)),'Imagem não encontrada.');
  return {
    reference:v.text(p.reference || sku,80),name:v.text(p.name),category_id:category,price_cents:price,
    old_price_cents:status==='promotion'?old:null,description:v.text(p.description ?? '',5000,false),
    specs_json:v.specs(p.specs || {}),image,commercial_terms:v.text(p.commercialTerms || 'Preço, disponibilidade, entrega e pagamento sujeitos à confirmação.',2000),
    active:v.flag(p.active ?? true),sku,dimensions:v.text(p.dimensions ?? '',200,false),length_mm:null,
    unit,status,featured:v.flag(p.featured ?? false),stock:stock===null?null:Math.ceil(stock),stock_milli:stock===null?null:Math.round(stock*1000),low_stock:v.integer(p.lowStock ?? settings(db).defaultLowStock,0,100000000)
  };
}
export function saveProduct(db,user,input,id,action='product_updated') {
  return transaction(db,()=>writeProduct(db,user,input,id,action));
}
export function writeProduct(db,user,input,id,action='product_updated') {
  const before=id?getProduct(db,id):null;
  if(before && input.version!==undefined) v.check(input.version===before.version,'Este produto mudou em outra operação. Atualize a lista.',409);
  const data=validateProduct(db,input),keys=Object.keys(data);
  let productId=id;
  if(id) db.prepare(`UPDATE products SET ${keys.map(k=>`${k}=?`).join(',')},version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...Object.values(data),id);
  else {const r=db.prepare(`INSERT INTO products(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(data));productId=Number(r.lastInsertRowid);}
  const after=getProduct(db,productId);audit(db,user,before?action:'product_created','product',productId,before,after);return productDTO(after);
}
export function deleteProduct(db,user,id,version) {
  const before=getProduct(db,id);if(version!==undefined)v.check(version===before.version,'Produto alterado. Atualize a lista.',409);
  db.prepare('UPDATE products SET active=0,deleted_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
  audit(db,user,'product_deleted','product',id,before,{...before,active:0,deleted:true});
}
export function productList(db,url) {
  const q=url.searchParams,where=['p.deleted_at IS NULL'],args=[];
  const term=(q.get('q') || '').trim();v.check(term.length<=200,'Busca muito longa.');
  if(term) {where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.reference LIKE ? ESCAPE '\\')");const pattern=`%${term.replace(/[\\%_]/g,'\\$&')}%`;args.push(pattern,pattern,pattern);}
  if(q.get('category')) {where.push('p.category_id=?');args.push(v.slug(q.get('category')));}
  if(q.get('status')) {const s=q.get('status');v.check(['active','promotion','unavailable','inactive'].includes(s),'Status inválido.');
    where.push(s==='inactive'?'p.active=0':s==='unavailable'?"p.active=1 AND (p.status='unavailable' OR p.stock_milli=0)":`p.active=1 AND p.status=? AND (p.stock_milli IS NULL OR p.stock_milli>0)`);if(['active','promotion'].includes(s))args.push(s);}
  if(q.has('featured') && q.get('featured')!=='') {v.check(['0','1'].includes(q.get('featured')));where.push('p.featured=?');args.push(Number(q.get('featured')));}
  if(q.get('stock')) {v.check(['low','zero','unmanaged'].includes(q.get('stock')));where.push({low:'p.stock_milli>0 AND p.stock_milli<=p.low_stock*1000',zero:'p.stock_milli=0',unmanaged:'p.stock_milli IS NULL'}[q.get('stock')]);}
  if(q.get('price')) {v.check(['defined','consultation'].includes(q.get('price')));where.push(q.get('price')==='defined'?'p.price_cents IS NOT NULL':'p.price_cents IS NULL');}
  const page=v.integer(Number(q.get('page') || 1),1,1000000),size=v.integer(Number(q.get('size') || 20),1,100);
  const order={name:'p.name COLLATE NOCASE,p.id',newest:'p.id DESC',stock:'p.stock_milli ASC,p.id',price:'p.price_cents ASC,p.id'}[q.get('sort') || 'newest'];v.check(order,'Ordenação inválida.');
  const clause=where.join(' AND '),total=db.prepare(`SELECT count(*) AS n FROM products p WHERE ${clause}`).get(...args).n;
  return {items:db.prepare(`${productSelect} WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args,size,(page-1)*size).map(productDTO),total,page,size,
    alerts:db.prepare('SELECT sum(CASE WHEN stock_milli=0 THEN 1 ELSE 0 END) AS zero,sum(CASE WHEN stock_milli>0 AND stock_milli<=low_stock*1000 THEN 1 ELSE 0 END) AS low FROM products WHERE deleted_at IS NULL').get()};
}
export function bulkProducts(db,user,input) {
  v.check(Array.isArray(input.items)&&input.items.length>=1&&input.items.length<=100,'Selecione de 1 a 100 produtos.');
  v.check(['delete','activate','deactivate','available','unavailable','feature','unfeature','price'].includes(input.action),'Ação inválida.');
  v.check(new Set(input.items.map(i=>i.id)).size===input.items.length,'Seleção duplicada.');
  return transaction(db,()=>{
    for(const item of input.items) {
      const row=getProduct(db,item.id);v.integer(item.version);v.check(row.version===item.version,'Um produto da seleção mudou. Atualize a lista.',409);
      if(input.action==='delete') deleteProduct(db,user,row.id,item.version);
      else {
        const p=productDTO(row);
        if(input.action==='activate') p.active=true;if(input.action==='deactivate')p.active=false;
        if(input.action==='available')p.status=p.oldPrice?'promotion':'active';if(input.action==='unavailable')p.status='unavailable';
        if(input.action==='feature')p.featured=true;if(input.action==='unfeature')p.featured=false;
        if(input.action==='price'){p.price=input.price;p.oldPrice=null;if(p.status==='promotion')p.status='active';}
        writeProduct(db,user,p,row.id,`bulk_${input.action}`);
      }
    }
    return {updated:input.items.length};
  });
}

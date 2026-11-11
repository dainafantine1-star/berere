import { randomUUID } from 'node:crypto';
import * as v from './validation.js';
import { transaction, productDTO,settings } from './db.js';
import { productSelect, validateProduct, writeProduct } from './products.js';
import { audit } from './audit.js';

const columns=['sku','name','reference','category','price','oldPrice','stock','lowStock','status','active','featured','dimensions','unit','description','image','commercialTerms'];
const cell=value=>{let s=String(value??'');if(typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(s))s=`'${s}`;return `"${s.replace(/"/g,'""')}"`;};
export const csv=rows=>'\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
export function templateCSV(){return csv([columns,['BER-EXEMPLO','Fruta exemplo','REF-EXEMPLO','frutas','','','10','3','active','1','0','Por kg','kg','Descrição do produto','','Preço e entrega sujeitos à confirmação.']]);}
export function parseCSV(source) {
  v.check(typeof source==='string' && Buffer.byteLength(source)<=1024*1024,'CSV deve ter até 1 MB.');
  const input=source.replace(/^\uFEFF/,''),delimiter=input.split(/\r?\n/,1)[0].includes(';')?';':',';
  const rows=[];let row=[],field='',quoted=false,closed=false;
  for(let i=0;i<input.length;i++) {
    const c=input[i];
    if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
    else if(c==='"'){v.check(field===''&&!closed,'Aspas inválidas no CSV.');quoted=true;}
    else if(c===delimiter){row.push(field);field='';closed=false;}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&input[i+1]==='\n')i++;row.push(field);if(row.some(x=>x!==''))rows.push(row);row=[];field='';closed=false;v.check(rows.length<=501,'Importe até 500 produtos por arquivo.');}
    else{v.check(!closed || /\s/.test(c),'Texto inválido após aspas no CSV.');if(!closed)field+=c;}
  }
  v.check(!quoted,'Aspas não fechadas no CSV.');row.push(field);if(row.some(x=>x!==''))rows.push(row);
  v.check(rows.length>=2&&rows.length<=501,'CSV deve conter cabeçalho e de 1 a 500 produtos.');
  const headers=rows.shift().map(h=>h.trim());v.check(new Set(headers).size===headers.length,'Cabeçalhos duplicados.');
  v.check(['sku','name','category','price'].every(c=>headers.includes(c)),'Use o modelo: sku, name, category e price são obrigatórios.');
  v.check(headers.every(h=>columns.includes(h)),'Coluna desconhecida. Use o modelo do painel.');
  return rows.map((r,i)=>({line:i+2,values:r.length===headers.length?Object.fromEntries(headers.map((h,j)=>[h,r[j].trim().replace(/^'(?=[=+@-])/,'')])):null}));
}
function numeric(value,nullable=false) {
  if(!value && nullable)return null;
  v.check(typeof value==='string'&&/^\d+(?:[.,]\d{1,3})?$/.test(value),'Número inválido. Não use separador de milhar.');return Number(value.replace(',','.'));
}
function boolean(value,fallback){if(value==null||value==='')return fallback;v.check(['0','1','true','false'].includes(value),'Booleano deve ser 0 ou 1.');return ['1','true'].includes(value);}
function convert(row,old,defaultLowStock=5) {
  return {...old,sku:row.sku,reference:row.reference || old?.reference || row.sku,name:row.name,category:row.category,
    price:numeric(row.price,true),oldPrice:numeric(row.oldPrice,true),stock:numeric(row.stock,true),lowStock:row.lowStock?numeric(row.lowStock):old?.lowStock ?? defaultLowStock,
    status:row.status || 'active',active:boolean(row.active,true),featured:boolean(row.featured,false),dimensions:row.dimensions || '',
    unit:row.unit || 'un',description:row.description || '',image:row.image || old?.image || '',specs:old?.specs || {},
    commercialTerms:row.commercialTerms || old?.commercialTerms || 'Preço, disponibilidade, entrega e pagamento sujeitos à confirmação.'};
}
export function previewImport(db,user,input) {
  v.check(['create','update','upsert'].includes(input.mode),'Modo de importação inválido.');
  const seen=new Set(),rows=[];
  for(const entry of parseCSV(input.csv)) {
    const result={line:entry.line,sku:entry.values?.sku || '',name:entry.values?.name || '',errors:[]};
    try {
      v.check(entry.values,'Quantidade de colunas incorreta.');const key=entry.values.sku.toLowerCase();
      v.check(!seen.has(key),'SKU repetido no arquivo.');seen.add(key);
      const found=db.prepare(`${productSelect} WHERE p.sku=? COLLATE NOCASE`).get(entry.values.sku);
      v.check(!found?.deleted_at,'SKU pertence a produto excluído. Use um novo SKU.');
      v.check(input.mode!=='create'||!found,'SKU já existe; selecione Atualizar ou Criar e atualizar.');
      v.check(input.mode!=='update'||found,'SKU não encontrado para atualização.');
      const product=convert(entry.values,found?productDTO(found):null,settings(db).defaultLowStock);validateProduct(db,product);
      result.product=product;result.id=found?.id || null;result.version=found?.version || null;result.operation=found?'update':'create';
    }catch(error){result.errors.push(error.status?error.message:'Não foi possível validar esta linha.');}
    rows.push(result);
  }
  db.prepare('DELETE FROM import_previews WHERE expires_at<? AND applied_at IS NULL').run(Date.now());
  const id=randomUUID(),expiresAt=Date.now()+15*60*1000;
  db.prepare('INSERT INTO import_previews(id,actor_id,payload_json,expires_at) VALUES(?,?,?,?)').run(id,user.id,JSON.stringify(rows),expiresAt);
  return {id,expiresAt,rows,valid:rows.every(r=>!r.errors.length),summary:{total:rows.length,errors:rows.filter(r=>r.errors.length).length,create:rows.filter(r=>r.operation==='create').length,update:rows.filter(r=>r.operation==='update').length}};
}
export function applyImport(db,user,input) {
  return transaction(db,()=>{
    const found=db.prepare('SELECT * FROM import_previews WHERE id=? AND actor_id=?').get(v.text(input.previewId,100),user.id);
    v.check(found,'Prévia inexistente.',404);if(found.applied_at)return JSON.parse(found.result_json);
    v.check(found.expires_at>Date.now(),'Prévia expirada. Gere novamente.',409);
    const rows=JSON.parse(found.payload_json);v.check(rows.every(r=>!r.errors.length),'Corrija as linhas com erro antes de importar.');
    for(const row of rows) {
      if(row.id){const current=db.prepare('SELECT version,deleted_at FROM products WHERE id=?').get(row.id);v.check(current&&!current.deleted_at&&current.version===row.version,'O catálogo mudou após a prévia. Gere outra prévia.',409);}
      else v.check(!db.prepare('SELECT 1 FROM products WHERE sku=? COLLATE NOCASE').get(row.product.sku),'Um SKU foi cadastrado após a prévia. Gere outra prévia.',409);
      writeProduct(db,user,{...row.product,version:row.version ?? undefined},row.id,'product_imported');
    }
    const result={created:rows.filter(r=>!r.id).length,updated:rows.filter(r=>r.id).length,total:rows.length};
    db.prepare('UPDATE import_previews SET applied_at=CURRENT_TIMESTAMP,result_json=? WHERE id=?').run(JSON.stringify(result),found.id);
    audit(db,user,'import_applied','import',found.id,null,result);return result;
  });
}
export function exportWooCSV(db,base) {
  const headers=['Type','SKU','Name','Published','Is featured?','Visibility in catalog','Description','In stock?','Stock','Low stock amount','Backorders allowed?','Regular price','Sale price','Categories','Images','Attribute 1 name','Attribute 1 value(s)','Attribute 1 visible','Attribute 1 global','Attribute 2 name','Attribute 2 value(s)','Attribute 2 visible','Attribute 2 global','Meta: bereree_reference','Meta: bereree_packaging','Meta: bereree_commercial_terms','Meta: bereree_price_on_request'];
  const rows=db.prepare(`${productSelect} WHERE p.deleted_at IS NULL ORDER BY p.id`).all().map(row=>{
    const p=productDTO(row);return ['simple',p.sku,p.name,p.active&&p.categoryActive?1:-1,p.featured?1:0,'visible',p.description,p.available?1:0,p.stock??'',p.lowStock,0,
      p.offer?p.oldPrice:p.price??'',p.offer?p.price:'',row.category_label.replace(/,/g,'\\,'),p.image?new URL(p.image,base+'/').href:'',
      'Unidade de cobrança',p.unit,1,0,'Embalagem',p.dimensions,1,0,p.reference,p.dimensions,p.commercialTerms,p.price==null?'yes':'no'];
  });
  return csv([headers,...rows]);
}

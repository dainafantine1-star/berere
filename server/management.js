import { transaction, productDTO } from './db.js';
import { productList, productSelect, getProduct, saveProduct, deleteProduct, bulkProducts } from './products.js';
import { previewImport, applyImport, exportWooCSV, templateCSV } from './csv.js';
import { uploadImage, deleteImage } from './media.js';
import { createAdmin, hashPassword, csrfToken, sessionToken } from './auth.js';
import { audit } from './audit.js';
import * as v from './validation.js';
import { commerce } from './commerce.js';

export async function management({db,user,req,url,p,origin}) {
  const path=url.pathname,method=req.method,ok=data=>({status:200,data});
  const handled=commerce({db,user,req,url,p});if(handled)return handled;
  if(path==='/api/admin/me' && method==='GET')return ok({...user,isOwner:!!user.isOwner,csrfToken:csrfToken(sessionToken(req))});
  if(path==='/api/admin/products/export' && method==='GET') {audit(db,user,'products_exported','catalog','all',null,{format:'woocommerce-csv'});return {csv:exportWooCSV(db,origin),filename:'produtos-woocommerce.csv'};}
  if(path==='/api/admin/import/template'&&method==='GET')return {csv:templateCSV(),filename:'modelo-produtos.csv'};
  if(path==='/api/admin/import/preview'&&method==='POST')return ok(previewImport(db,user,p));
  if(path==='/api/admin/import/apply'&&method==='POST')return ok(applyImport(db,user,p));
  if(path==='/api/admin/products/bulk'&&method==='POST')return ok(bulkProducts(db,user,p));
  if(path==='/api/admin/products'&&method==='GET')return ok(productList(db,url));
  if(path==='/api/admin/products'&&method==='POST')return {status:201,data:saveProduct(db,user,p)};
  const product=path.match(/^\/api\/admin\/products\/(\d+)$/);
  if(product) {
    const id=Number(product[1]);
    if(method==='GET')return ok(productDTO(getProduct(db,id)));
    if(method==='PUT')return ok(saveProduct(db,user,p,id));
    if(method==='PATCH') {v.check(Object.keys(p).every(k=>['price','stock','active','status','featured','version','oldPrice'].includes(k)),'Campo de atalho inválido.');const current=productDTO(getProduct(db,id));return ok(saveProduct(db,user,{...current,...p},id));}
    if(method==='DELETE'){transaction(db,()=>deleteProduct(db,user,id,url.searchParams.has('version')?v.integer(Number(url.searchParams.get('version'))):undefined));return ok({ok:true});}
  }
  if(path==='/api/admin/categories'&&method==='GET')return ok(db.prepare('SELECT c.*,count(p.id) AS product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.deleted_at IS NULL GROUP BY c.id ORDER BY c.sort_order,c.label').all());
  const category=path.match(/^\/api\/admin\/categories\/([a-z0-9-]+)$/);
  if((path==='/api/admin/categories'&&method==='POST')||(category&&method==='PUT')) {
    const result=transaction(db,()=>{
      const id=category?.[1] || v.slug(p.slug || p.id),before=category?db.prepare('SELECT * FROM categories WHERE id=?').get(id):null;
      if(category){v.check(before,'Categoria inexistente.',404);if(p.version!==undefined)v.check(before.version===p.version,'Categoria alterada. Atualize a lista.',409);}
      const label=v.text(p.label,100),slug=v.slug(p.slug || before?.slug || id),image=v.image(p.image || ''),icon=v.text(p.icon || '',20,false),order=v.integer(p.sortOrder ?? p.sort_order ?? 0,0,10000),active=v.flag(p.active);
      if(image.startsWith('uploads/'))v.check(db.prepare('SELECT 1 FROM media WHERE filename=?').get(image.slice(8)),'Imagem inexistente.');
      const color=p.color??before?.color??'#E8EFDC',description=v.text(p.description??before?.description??'',2000,false);v.check(/^#[a-f0-9]{6}$/i.test(color),'Cor inválida.');
      if(before)db.prepare('UPDATE categories SET label=?,slug=?,image=?,icon=?,sort_order=?,active=?,version=version+1 WHERE id=?').run(label,slug,image,icon,order,active,id);
      else db.prepare('INSERT INTO categories(id,label,slug,image,icon,sort_order,active) VALUES(?,?,?,?,?,?,?)').run(id,label,slug,image,icon,order,active);
      db.prepare('UPDATE categories SET color=?,description=? WHERE id=?').run(color,description,id);
      const after=db.prepare('SELECT * FROM categories WHERE id=?').get(id);audit(db,user,before?'category_updated':'category_created','category',id,before,after);return after;
    });return {status:category?200:201,data:result};
  }
  if(path==='/api/admin/media'&&method==='GET')return ok(db.prepare('SELECT m.*, (SELECT count(*) FROM products WHERE image=\'uploads/\'||m.filename)+(SELECT count(*) FROM categories WHERE image=\'uploads/\'||m.filename)+(SELECT count(*) FROM banners WHERE image=\'uploads/\'||m.filename)+(SELECT count(*) FROM company_settings WHERE json_extract(public_json,\'$.logo\')=\'uploads/\'||m.filename OR json_extract(public_json,\'$.heroImage\')=\'uploads/\'||m.filename) AS links FROM media m ORDER BY created_at DESC').all());
  if(path==='/api/admin/media'&&method==='POST')return {status:201,data:await uploadImage(db,user,p)};
  const media=path.match(/^\/api\/admin\/media\/([a-f0-9-]{36})$/);
  if(media&&method==='DELETE')return ok(await deleteImage(db,user,media[1]));
  if(path==='/api/admin/audit'&&method==='GET') {
    v.check(user.isOwner || user.role==='admin','Acesso restrito.',403);
    const page=v.integer(Number(url.searchParams.get('page') || 1),1,1000000);
    return ok({items:db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 50 OFFSET ?').all((page-1)*50),total:db.prepare('SELECT count(*) AS n FROM audit_log').get().n,page});
  }
  if(path==='/api/admin/users' || /^\/api\/admin\/users\//.test(path)) {
    v.check(user.isOwner,'Somente o proprietário gerencia acessos.',403);
    if(path==='/api/admin/users'&&method==='GET')return ok(db.prepare('SELECT id,email,role,active,is_owner AS isOwner,created_at FROM admin_users ORDER BY is_owner DESC,id').all());
    if(path==='/api/admin/users'&&method==='POST')return {status:201,data:transaction(db,()=>{const created=createAdmin(db,p);const active=v.flag(p.active ?? true);db.prepare('UPDATE admin_users SET active=? WHERE id=?').run(active,created.id);audit(db,user,'user_created','user',created.id,null,{email:p.email,role:p.role || 'admin',active});return created;})};
    const match=path.match(/^\/api\/admin\/users\/(\d+)$/);
    if(match&&method==='PUT')return ok(transaction(db,()=>{
      const before=db.prepare('SELECT id,email,role,active,is_owner AS isOwner FROM admin_users WHERE id=?').get(Number(match[1]));v.check(before,'Usuário inexistente.',404);
      v.check(!before.isOwner,'O acesso do proprietário não pode ser desativado ou rebaixado.',403);
      v.check(['admin','editor'].includes(p.role),'Perfil inválido.');const active=v.flag(p.active);
      db.prepare('UPDATE admin_users SET role=?,active=? WHERE id=?').run(p.role,active,before.id);
      if(p.password)db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(hashPassword(p.password),before.id);
      db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(before.id);
      audit(db,user,'user_updated','user',before.id,before,{email:before.email,role:p.role,active,passwordReset:!!p.password});return {ok:true};
    }));
  }
  if(path==='/api/admin/password'&&method==='PUT') {
    const { scryptSync, timingSafeEqual }=await import('node:crypto');
    const found=db.prepare('SELECT password_hash FROM admin_users WHERE id=?').get(user.id);const [salt,hash]=found.password_hash.split(':');
    v.text(p.currentPassword,200);v.check(timingSafeEqual(scryptSync(p.currentPassword,salt,64),Buffer.from(hash,'hex')),'Senha atual inválida.',400);
    const passwordHash=hashPassword(p.password);
    transaction(db,()=>{db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(passwordHash,user.id);db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(user.id);audit(db,user,'password_changed','user',user.id,null,{sessionsRevoked:true});});return ok({ok:true});
  }
  if(path==='/api/admin/revoke-sessions'&&method==='POST'){transaction(db,()=>{db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(user.id);audit(db,user,'sessions_revoked','user',user.id,null,{all:true});});return ok({ok:true});}
  return null;
}

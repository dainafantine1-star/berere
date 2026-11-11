import { settings,transaction } from './db.js';
import * as v from './validation.js';
import { audit } from './audit.js';

import { defaults } from './settings-defaults.js';
export function publicSettings(db){return {...defaults,...settings(db),version:db.prepare('SELECT version FROM company_settings WHERE id=1').get().version};}
export function destination(value){const result=v.text(value,2000);v.check(/^#[a-zA-Z][a-zA-Z0-9_-]*$/.test(result)||(/^\/(?!\/)[a-zA-Z0-9/_?=&%#.-]*$/.test(result)&&!result.startsWith('/api/'))||/^https:\/\/[^\s]+$/.test(result),'Destino deve ser uma seção, caminho da loja ou endereço HTTPS.');if(result.startsWith('https://')){const u=new URL(result);v.check(!u.username&&!u.password,'Destino inválido.');}return result;}
export function verifyImage(db,image){v.image(image);if(image.startsWith('uploads/'))v.check(db.prepare('SELECT 1 FROM media WHERE filename=?').get(image.slice(8)),'Imagem inexistente.');return image;}
export function saveSettings(db,user,input){
  v.check(user.isOwner||user.role==='admin','Acesso restrito.',403);
  return transaction(db,()=>{
    const before=publicSettings(db);if(input.version!==undefined)v.check(before.version===input.version,'As configurações mudaram. Atualize a tela.',409);
    const merged={...before,...input},base=v.company(merged);
    const data={...base};
    for(const key of ['whatsappMessage','region','heroTitle','heroText','aboutTitle','aboutText','footerText'])data[key]=v.text(merged[key],key==='aboutText'?5000:2000,false);
    data.logo=verifyImage(db,merged.logo);data.heroImage=verifyImage(db,merged.heroImage);
    v.check(['unavailable','hide'].includes(merged.stockZeroBehavior),'Comportamento de estoque inválido.');data.stockZeroBehavior=merged.stockZeroBehavior;
    data.defaultLowStock=v.integer(merged.defaultLowStock,0,100000000);data.maxQuoteQuantity=v.integer(merged.maxQuoteQuantity,1,10000);
    v.check(Array.isArray(merged.benefits)&&merged.benefits.length<=6,'Informe até seis benefícios.');data.benefits=merged.benefits.map(b=>({title:v.text(b.title,100),text:v.text(b.text,300)}));
    db.prepare('UPDATE company_settings SET public_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(JSON.stringify(data));
    audit(db,user,'company_updated','company',1,before,data);return publicSettings(db);
  });
}
export function saveBanner(db,user,input,id){return transaction(db,()=>{
  const before=id?db.prepare('SELECT * FROM banners WHERE id=?').get(id):null;if(id){v.check(before,'Banner inexistente.',404);if(input.version!==undefined)v.check(before.version===input.version,'O banner mudou. Atualize a tela.',409);}
  const data={tag:v.text(input.tag || '',100,false),title:v.text(input.title),body:v.text(input.body,2000,false),image:verifyImage(db,input.image || ''),cta:v.text(input.cta || 'Ver catálogo',100),destination:destination(input.destination || '#catalogo'),sort_order:v.integer(input.sortOrder ?? input.sort_order ?? 0,0,10000),active:v.flag(input.active)};
  const keys=Object.keys(data);if(id)db.prepare(`UPDATE banners SET ${keys.map(k=>`${k}=?`).join(',')},version=version+1 WHERE id=?`).run(...Object.values(data),id);
  else id=Number(db.prepare(`INSERT INTO banners(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(data)).lastInsertRowid);
  const after=db.prepare('SELECT * FROM banners WHERE id=?').get(id);audit(db,user,before?'banner_updated':'banner_created','banner',id,before,after);return after;
});}

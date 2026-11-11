import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { root, transaction } from './db.js';
import { audit } from './audit.js';
import * as v from './validation.js';
import { withMediaLock } from './media-lock.js';

export function mediaDirectory() {return process.env.UPLOAD_DIR || resolve(dirname(process.env.DATABASE_PATH || resolve(root,'storage/bereree.sqlite')),'uploads');}
export function uploadImage(db,user,input){return withMediaLock(()=>upload(db,user,input));}
async function upload(db,user,input) {
  v.check(input.usage===undefined||['photo','logo'].includes(input.usage),'Uso de imagem inválido.');
  v.text(input.name,200);v.check(['image/jpeg','image/png','image/webp'].includes(input.type),'Use JPEG, PNG ou WebP.');
  v.check(typeof input.data==='string' && input.data.length<=7000000 && /^[a-z0-9+/]*={0,2}$/i.test(input.data),'Arquivo inválido ou maior que 5 MB.');
  const bytes=Buffer.from(input.data,'base64');v.check(bytes.length>0&&bytes.length<=5*1024*1024,'A imagem deve ter até 5 MB.');
  let output,info;
  try {
    const pipeline=sharp(bytes,{limitInputPixels:24000000,failOn:'warning',animated:false});const meta=await pipeline.metadata();
    v.check(['jpeg','png','webp'].includes(meta.format)&&(!meta.pages||meta.pages===1),'Formato de imagem não permitido.');
    v.check({'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[input.type]===meta.format,'O conteúdo não corresponde ao formato declarado.');
    ({data:output,info}=await pipeline.rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp(input.usage==='logo'?{lossless:true}:{quality:85}).toBuffer({resolveWithObject:true}));
  }catch(error){if(error.status)throw error;throw new v.HttpError(400,'Imagem inválida, incompleta ou com dimensões excessivas.');}
  const id=randomUUID(),filename=`${id}.webp`;await mkdir(mediaDirectory(),{recursive:true});const path=resolve(mediaDirectory(),filename);
  await writeFile(path,output,{flag:'wx'});
  const variants=[];
  try{for(const width of [320,640,960]){if(width>=info.width)continue;const data=await sharp(output).resize({width}).webp(input.usage==='logo'?{lossless:true}:{quality:80}).toBuffer();const filename=`${id}-${width}.webp`;await writeFile(resolve(mediaDirectory(),filename),data,{flag:'wx'});variants.push({width,filename,bytes:data.length});}}catch(error){await Promise.all([path,...variants.map(x=>resolve(mediaDirectory(),x.filename))].map(p=>unlink(p).catch(()=>{})));throw error;}
  try {transaction(db,()=>{db.prepare('INSERT INTO media(id,filename,original_name,mime,bytes,width,height,created_by) VALUES(?,?,?,?,?,?,?,?)').run(id,filename,input.name,'image/webp',output.length,info.width,info.height,user.id);for(const x of variants)db.prepare('INSERT INTO media_variants VALUES(?,?,?,?)').run(id,x.width,x.filename,x.bytes);audit(db,user,'image_uploaded','media',id,null,{filename,bytes:output.length});});}
  catch(error){await Promise.all([path,...variants.map(x=>resolve(mediaDirectory(),x.filename))].map(p=>unlink(p).catch(()=>{})));throw error;}
  return {id,url:`uploads/${filename}`,width:info.width,height:info.height};
}
export function deleteImage(db,user,id){return withMediaLock(()=>remove(db,user,id));}
async function remove(db,user,id) {
  const media=db.prepare('SELECT * FROM media WHERE id=?').get(v.text(id,100));v.check(media,'Imagem inexistente.',404);
  const url=`uploads/${media.filename}`;
  v.check(!db.prepare('SELECT 1 FROM products WHERE image=? UNION SELECT 1 FROM categories WHERE image=?').get(url,url),'Imagem vinculada a um produto ou categoria. Substitua-a antes de excluir.',409);
  v.check(!db.prepare("SELECT 1 FROM banners WHERE image=? UNION SELECT 1 FROM company_settings WHERE json_extract(public_json,'$.logo')=? OR json_extract(public_json,'$.heroImage')=?").get(url,url,url),'Imagem vinculada à empresa ou campanha. Substitua-a antes de excluir.',409);
  const variants=db.prepare('SELECT filename FROM media_variants WHERE media_id=?').all(id);
  // Remove access first; a failed filesystem cleanup leaves an inaccessible orphan.
  transaction(db,()=>{db.prepare('DELETE FROM media WHERE id=?').run(id);audit(db,user,'image_deleted','media',id,{filename:media.filename},null);});
  await Promise.all([media.filename,...variants.map(x=>x.filename)].map(filename=>unlink(resolve(mediaDirectory(),filename)).catch(()=>{})));return {ok:true};
}

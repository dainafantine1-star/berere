import { backup,DatabaseSync } from 'node:sqlite';
import { createHash,randomBytes,randomUUID,createCipheriv,createDecipheriv } from 'node:crypto';
import { mkdir,readFile,writeFile,rename,unlink,copyFile,stat } from 'node:fs/promises';
import { resolve,dirname,basename,join } from 'node:path';
import { withMediaLock } from './media-lock.js';
import { mediaDirectory } from './media.js';
import { root } from './db.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const keyBytes=key=>{if(!key)return null;const bytes=Buffer.from(key,'base64');if(bytes.length!==32||bytes.toString('base64')!==key)throw Error('BACKUP_KEY deve conter 32 bytes em base64.');return bytes;};
export function validateBackupConfig(){keyBytes(process.env.BACKUP_KEY);if(process.env.NODE_ENV==='production'&&!process.env.BACKUP_KEY)throw Error('Configure BACKUP_KEY para backups criptografados em produção.');}
export async function createBackup(db,{directory=process.env.BACKUP_DIR||resolve(root,'storage/backups'),uploads=mediaDirectory(),key=process.env.BACKUP_KEY,mirror=process.env.BACKUP_MIRROR_DIR}={}) {
  const secret=keyBytes(key);
  if(process.env.NODE_ENV==='production'&&!secret)throw Error('Backup de produção exige criptografia.');
  return withMediaLock(async()=>{
    await mkdir(directory,{recursive:true,mode:0o700});
    const id='backup-'+new Date().toISOString().replaceAll(/[:.]/g,'-')+'-'+randomUUID(),temp=resolve(directory,id+'.sqlite.tmp');
    let snapshot;
    try {
      await backup(db,temp);
      snapshot=new DatabaseSync(temp,{readOnly:true});
      if(snapshot.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||snapshot.prepare('PRAGMA foreign_key_check').all().length)throw Error('Backup inconsistente.');
      const hasVariants=snapshot.prepare("SELECT 1 FROM sqlite_master WHERE name='media_variants'").get();
      const names=snapshot.prepare('SELECT filename FROM media'+(hasVariants?' UNION SELECT filename FROM media_variants':'')).all().map(r=>r.filename);
      const files=[{path:'store.sqlite',bytes:await readFile(temp)}];
      for(const filename of names){if(!/^[a-f0-9-]{36}(?:-\d+)?\.webp$/.test(filename))throw Error('Nome de mídia inválido.');files.push({path:'uploads/'+filename,bytes:await readFile(resolve(uploads,filename))});}
      const manifest={format:1,createdAt:new Date().toISOString(),node:process.version,migrations:snapshot.prepare('SELECT name FROM migrations ORDER BY name').all().map(r=>r.name),files:files.map(f=>({path:f.path,bytes:f.bytes.length,sha256:hash(f.bytes)}))};
      const plain=Buffer.from(JSON.stringify({manifest,files:files.map(f=>({path:f.path,data:f.bytes.toString('base64')}))}));
      let payload;
      if(secret){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);payload=Buffer.concat([Buffer.from('MPB1'),iv,cipher.getAuthTag(),encrypted]);}
      else payload=Buffer.concat([Buffer.from('MPB0'),plain]);
      const file=resolve(directory,id+'.mpbackup');
      await writeFile(file+'.tmp',payload,{flag:'wx',mode:0o600});await rename(file+'.tmp',file);
      if(mirror){await mkdir(mirror,{recursive:true,mode:0o700});const destination=resolve(mirror,basename(file));await copyFile(file,destination+'.tmp');if(hash(await readFile(destination+'.tmp'))!==hash(payload))throw Error('Cópia externa inválida.');await rename(destination+'.tmp',destination);}
      return {file,encrypted:!!secret,files:files.length,bytes:payload.length,createdAt:manifest.createdAt};
    }finally{snapshot?.close();for(const file of [temp,temp+'-wal',temp+'-shm'])await unlink(file).catch(()=>{});}
  });
}

export async function restoreBackup(file,target,{key=process.env.BACKUP_KEY}={}) {
  const destination=resolve(target);
  try{await stat(destination);throw Error('A restauração exige um diretório de destino inexistente.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const data=await readFile(file);let plain;
  if(data.subarray(0,4).toString()==='MPB1'){const secret=keyBytes(key);if(!secret)throw Error('Informe BACKUP_KEY para restaurar.');const decipher=createDecipheriv('aes-256-gcm',secret,data.subarray(4,16));decipher.setAuthTag(data.subarray(16,32));plain=Buffer.concat([decipher.update(data.subarray(32)),decipher.final()]);}
  else if(data.subarray(0,4).toString()==='MPB0')plain=data.subarray(4);
  else throw Error('Formato de backup desconhecido.');
  const {manifest,files}=JSON.parse(plain.toString());
  if(manifest?.format!==1||!Array.isArray(files)||files.length!==manifest.files?.length||!files.length)throw Error('Manifesto inválido.');
  const checked=[],names=new Set();
  for(const [i,entry]of files.entries()){
    if(entry.path!=='store.sqlite'&&!/^uploads\/[a-f0-9-]{36}(?:-\d+)?\.webp$/.test(entry.path))throw Error('Caminho inválido no backup.');
    if(names.has(entry.path))throw Error('Arquivo duplicado no backup.');names.add(entry.path);
    const bytes=Buffer.from(entry.data,'base64'),expected=manifest.files[i];
    if(expected.path!==entry.path||expected.bytes!==bytes.length||expected.sha256!==hash(bytes))throw Error('Arquivo corrompido no backup.');
    checked.push({...entry,bytes});
  }
  if(!names.has('store.sqlite'))throw Error('Banco ausente no backup.');
  // Exclusive mkdir: never replace an existing tree, including a concurrent restore.
  await mkdir(dirname(destination),{recursive:true,mode:0o700});await mkdir(destination,{mode:0o700});await mkdir(join(destination,'uploads'),{mode:0o700});
  for(const entry of checked)await writeFile(resolve(destination,entry.path),entry.bytes,{flag:'wx',mode:0o600});
  const db=new DatabaseSync(join(destination,'store.sqlite'));
  try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Banco restaurado inconsistente.');db.exec('DELETE FROM admin_sessions;');if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='shop_sessions'").get())db.exec('DELETE FROM shop_sessions;');db.exec('PRAGMA wal_checkpoint(TRUNCATE);');}finally{db.close();}
  return {directory:destination,files:checked.length,createdAt:manifest.createdAt,sessionsRevoked:true};
}

export function scheduleBackups(db){
  validateBackupConfig();const hours=Number(process.env.BACKUP_INTERVAL_HOURS||24);
  if(!Number.isFinite(hours)||hours<1||hours>168)throw Error('BACKUP_INTERVAL_HOURS deve estar entre 1 e 168.');
  let running=false,last=Promise.resolve();
  const run=()=>{if(running)return last;running=true;last=(async()=>{try{const result=await createBackup(db);console.log(JSON.stringify({event:'backup_completed',encrypted:result.encrypted,files:result.files,bytes:result.bytes}));}catch(error){console.error(JSON.stringify({event:'backup_failed',code:error.code||error.name}));}finally{running=false;}})();return last;};
  const timer=setInterval(run,hours*3600000);timer.unref();void run();return async()=>{clearInterval(timer);await last;};
}

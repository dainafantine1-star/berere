import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { openDatabase } from './db.js';
import { createOwner } from './auth.js';

// Local console only. There is no public bootstrap endpoint or default password.
const db=openDatabase();let rl;let muted=false;
try {
  if(db.prepare('SELECT 1 FROM admin_users WHERE is_owner=1').get()) throw new Error('O proprietário já está cadastrado.');
  if(!process.stdin.isTTY) throw new Error('Execute este comando em um terminal interativo.');
  const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk,encoding);done();}});
  rl=createInterface({input:process.stdin,output,terminal:true});
  const email=await rl.question('E-mail do proprietário: ');
  process.stdout.write('Senha (mínimo de 12 caracteres; oculta): ');muted=true;
  const password=await rl.question('');
  process.stdout.write('\nConfirme a senha: ');const confirmation=await rl.question('');muted=false;process.stdout.write('\n');
  if(password!==confirmation) throw new Error('As senhas não coincidem.');
  createOwner(db,{email,password});console.log('Proprietário criado. Acesse /admin para entrar.');
}catch(error){console.error(error.status?error.message:error.message==='As senhas não coincidem.'||error.message==='O proprietário já está cadastrado.'||error.message==='Execute este comando em um terminal interativo.'?error.message:'Não foi possível criar o proprietário. Verifique o e-mail e tente novamente.');process.exitCode=1;}
finally{rl?.close();db.close();}

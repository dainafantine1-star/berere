import { openDatabase } from './db.js';
import { createBackup,restoreBackup } from './backup.js';
import { snapshot } from './analytics.js';
try{
  const command=process.argv[2];
  if(command==='restore'){
    if(!process.argv[3]||!process.argv[4])throw Error('Uso: npm run backup:restore -- arquivo.mpbackup novo-diretorio');
    console.log(JSON.stringify(await restoreBackup(process.argv[3],process.argv[4])));
  }else{
    const db=openDatabase();try{if(command==='backup')console.log(JSON.stringify(await createBackup(db)));else if(command==='snapshot')console.log(JSON.stringify(snapshot(db)));else throw Error('Comando desconhecido.');}finally{db.close();}
  }
}catch(error){console.error(error.message);process.exitCode=1;}

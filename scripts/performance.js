import {readFile,readdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const assets=await readdir('dist/assets'),results=[];
async function budget(label,files,limit){let bytes=0;for(const file of files)bytes+=gzipSync(await readFile(file)).length;results.push({label,bytes,limit,ok:bytes<=limit});if(bytes>limit)process.exitCode=1;}
await budget('JavaScript do app gzip',assets.filter(f=>f.endsWith('.js')).map(f=>'dist/assets/'+f),160000);
await budget('CSS do app gzip',assets.filter(f=>f.endsWith('.css')).map(f=>'dist/assets/'+f),30000);
await budget('JavaScript do ADM gzip',['js/core.js','admin/admin.js','admin/commerce.js','admin/analytics.js','admin/app-settings.js','admin/accessibility.js'],65000);
console.table(results);
if(process.argv.includes('--save'))await writeFile('performance-results.json',JSON.stringify({measuredAt:new Date().toISOString(),results},null,2));

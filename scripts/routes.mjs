import {mkdir,copyFile,writeFile,readdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {routes,products,categories} from './catalog.mjs';
for(const route of routes.filter(r=>r!=='/'&&r!=='/admin'&&r!=='/gestao')){const dir=join('dist',route.slice(1));await mkdir(dir,{recursive:true});await copyFile('dist/index.html',join(dir,'index.html'));}
await copyFile('dist/index.html','dist/404.html');
const assets=(await readdir('dist/assets')).filter(f=>/\.(js|css|woff2)$/.test(f)).map(f=>'/assets/'+f);
const hash=createHash('sha256').update(await readFile('dist/index.html')).digest('hex').slice(0,10),cache='bereree-shell-'+hash;
const pre=['/index.html','/favicon.svg','/app-icon.svg','/app-icon-192.png','/app-icon-512.png','/app-icon-maskable-512.png','/apple-touch-icon.png','/bereree-logo.png','/manifest.webmanifest',...assets];
await writeFile('dist/sw.js',`const CACHE=${JSON.stringify(cache)},ASSETS=${JSON.stringify(pre)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('bereree-shell-')||k.startsWith('cdf-shell-'))&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const req=event.request,url=new URL(req.url);if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/admin')||url.pathname.startsWith('/uploads/'))return;
if(req.mode==='navigate'){event.respondWith(fetch(req).catch(()=>caches.match('/index.html')));return;}
if(ASSETS.includes(url.pathname)||/\\.(png|jpg|svg)$/.test(url.pathname)){event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(response=>{if(response.ok&&response.type==='basic'){const clone=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,clone)));}return response;})));}});
`);
console.log('Rotas geradas:',routes.length,'· PWA cache:',cache);

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, openDatabase, catalog, settings, productDTO } from './db.js';
import { authorize, login, digest, sessionToken, sessionCookie, csrfToken, loginThrottle } from './auth.js';
import { management } from './management.js';
import { mediaDirectory } from './media.js';
import { createQuote } from './orders.js';
import { createHash,randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { scheduleBackups } from './backup.js';
import { clientAddress } from './client-address.js';
import * as v from './validation.js';
import { recordEvent, metrics, reportCSV, snapshot } from './analytics.js';
import {content,saveContent,shopRoute,updateDelivery} from './shop.js';

async function body(req,max=65536) {
  v.check(req.headers['content-type']?.split(';')[0] === 'application/json','Envie JSON.',415);
  if(Number(req.headers['content-length'])>max){req.resume();throw new v.HttpError(413,'Solicitação muito grande.');}
  let size=0; const chunks=[];
  for await (const chunk of req) { size+=chunk.length; v.check(size<=max,'Solicitação muito grande.',413); chunks.push(chunk); }
  try { const data=JSON.parse(Buffer.concat(chunks).toString('utf8')); v.check(data && typeof data==='object' && !Array.isArray(data)); return data; }
  catch (e) { if (e.status) throw e; throw new v.HttpError(400,'JSON inválido.'); }
}
export function createApp({db=openDatabase(),origin=process.env.PUBLIC_ORIGIN}={}) {
  if (process.env.NODE_ENV==='production') v.check(origin && /^https:\/\//.test(origin),'Configure PUBLIC_ORIGIN com HTTPS.');
  const limits=new Map();
  snapshot(db);
  const snapshotTimer=setInterval(()=>{try{snapshot(db);}catch(error){console.error(JSON.stringify({event:'snapshot_failed',code:error.code||error.name}));}},300000);
  snapshotTimer.unref();
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Request-ID',randomUUID());
    if(process.env.NODE_ENV==='production')res.setHeader('Strict-Transport-Security','max-age=31536000');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; frame-src https://www.openstreetmap.org; media-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,'http://localhost'); const path=url.pathname; const method=req.method;
      if (path.startsWith('/api/')) {
        const ip=clientAddress(req); const now=Date.now();
        for(const [k,x] of limits) if(x.until<now) limits.delete(k);
        v.check(limits.size<10000 || limits.has(ip),'Serviço ocupado.',503);
        const limit=limits.get(ip)||{count:0,logins:0,until:now+60000}; limit.count++; limits.set(ip,limit);
        v.check(limit.count<=180,'Muitas solicitações. Aguarde um minuto.',429);
        if(!['GET','HEAD'].includes(method)) {
          const expected=origin || `http://${req.headers.host}`;
          v.check(!req.headers.origin || req.headers.origin===expected,'Origem não permitida.',403);
          v.check(req.headers['sec-fetch-site']!=='cross-site','Origem não permitida.',403);
        }
        if(path==='/api/health' && method==='GET') {db.prepare('SELECT 1').get();return send(200,{status:'ok'});}
        if(path==='/api/catalog' && method==='GET') return send(200,{...catalog(db),app:content(db)});
        if(path.startsWith('/api/shop/'))return send(200,shopRoute({db,req,res,url,input:!['GET','HEAD'].includes(method)?await body(req):null,ip}));
        if(path==='/api/settings' && method==='GET') return send(200,settings(db));
        if(path==='/api/quotes' && method==='POST') return send(201,createQuote(db,await body(req)));
        if(path==='/api/events' && method==='POST') {
          return send(201,recordEvent(db,await body(req)));
        }
        if(path==='/api/admin/login' && method==='POST') {
          v.check(++limit.logins<=5,'Muitas tentativas. Aguarde um minuto.',429);const input=await body(req);loginThrottle(db,input.email,ip);
          const auth=login(db,input);
          if(input.session==='cookie') {
            const previous=sessionToken(req);if(previous)db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(digest(previous));
            res.setHeader('Set-Cookie',sessionCookie(auth.token,auth.expiresAt,process.env.NODE_ENV==='production'));
            return send(200,{expiresAt:auth.expiresAt,csrfToken:csrfToken(auth.token)});
          }
          return send(200,auth);
        }
        if(path.startsWith('/api/admin/')) {
          const user=authorize(db,req,path.includes('/users') || path==='/api/admin/settings');
          if(!['GET','HEAD'].includes(method)) {limit.sensitive=(limit.sensitive || 0)+1;v.check(limit.sensitive<=50,'Muitas alterações. Aguarde um minuto.',429);}
          const p=['POST','PUT','PATCH'].includes(method) ? await body(req,path==='/api/admin/media'?7200000:path==='/api/admin/import/preview'?2200000:65536) : null;
          if(path==='/api/admin/app-settings'&&method==='GET'){v.check(user.isOwner||user.role==='admin','Acesso restrito.',403);return send(200,content(db));}
          if(path==='/api/admin/app-settings'&&method==='PUT')return send(200,saveContent(db,user,p));
          const deliveryMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]+)\/delivery$/);
          if(deliveryMatch&&method==='PUT')return send(200,updateDelivery(db,user,deliveryMatch[1],p));
          if(path==='/api/admin/logout' && method==='POST') {db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(digest(sessionToken(req)));res.setHeader('Set-Cookie',sessionCookie('',0,process.env.NODE_ENV==='production'));return send(200,{ok:true});}
          const handled=await management({db,user,req,url,p,origin:origin || `http://${req.headers.host}`});
          if(handled) {
            if(handled.csv!==undefined){res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${handled.filename}"`,'Cache-Control':'no-store'});return res.end(handled.csv);}
            return send(handled.status,handled.data);
          }
          if(path==='/api/admin/catalog' && method==='GET') return send(200,{...catalog(db),products:db.prepare('SELECT p.*,c.label AS category_label,c.active AS category_active FROM products p JOIN categories c ON c.id=p.category_id WHERE p.deleted_at IS NULL').all().map(productDTO),categories:db.prepare('SELECT * FROM categories').all()});
          if((path==='/api/admin/metrics'||path==='/api/admin/reports/export')&&method==='GET') {
            v.check(user.isOwner||user.role==='admin','Acesso restrito.',403);
            const data=metrics(db,url.searchParams);
            if(path.endsWith('/export')){const type=url.searchParams.get('type');const csv=reportCSV(data,type);res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="relatorio-${type}.csv"`,'Cache-Control':'no-store'});return res.end(csv);}
            return send(200,data);
          }
          void user;
        }
        throw new v.HttpError(404,'Endpoint inexistente.');
      }
      v.check(method==='GET' || method==='HEAD','Método não permitido.',405);
      // Only public assets are served. Database, sources, credentials and tests cannot be downloaded.
      const requested=decodeURIComponent(path);
      if(/^\/uploads\/[a-f0-9-]{36}(?:-(?:320|640|960))?\.webp$/.test(requested)) {
        const filename=requested.slice(9);v.check(db.prepare('SELECT 1 FROM media WHERE filename=? UNION SELECT 1 FROM media_variants WHERE filename=?').get(filename,filename),'Imagem inexistente.',404);
        const bytes=await readFile(resolve(mediaDirectory(),filename));res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'public, max-age=31536000, immutable'});return res.end(method==='HEAD'?undefined:bytes);
      }
      const isAdmin=requested==='/admin'||requested==='/admin/'||/^\/admin\/(?:admin|commerce|analytics|app-settings|accessibility)\.(?:css|js)$/.test(requested);
      const isCore=['/js/core.js','/css/accessibility.css'].includes(requested);
      const appRoute=/^\/(?:index\.html|boas-vindas|login|cadastro|categorias|produtos|ofertas|favoritos|cesta|pedidos|videos|lista-compras|instalar|gestao|perfil(?:\/(?:enderecos|configuracoes))?|pedido\/acompanhamento|checkout\/(?:endereco|pagamento|revisao)|categoria\/[a-z0-9-]+|produto\/[a-z0-9-]+)?\/?$/.test(requested);
      const asset=/^\/(?:assets\/[a-zA-Z0-9_.-]+|[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp|svg|webmanifest|json|js))$/.test(requested);
      v.check(isAdmin||isCore||appRoute||asset,'Página inexistente.',404);
      const file=isAdmin?resolve(root,requested==='/admin'||requested==='/admin/'?'admin/index.html':`.${requested}`):isCore?resolve(root,`.${requested}`):resolve(root,'dist',appRoute?'index.html':`.${requested}`);
      v.check(file.startsWith(resolve(root)+ (process.platform==='win32'?'\\':'/')),'Página inexistente.',404);
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.webmanifest':'application/manifest+json','.json':'application/json'}[extname(file)];
      v.check(mime,'Arquivo não permitido.',404);
      let bytes=await readFile(file);const etag='"'+createHash('sha256').update(bytes).digest('hex')+'"';res.setHeader('ETag',etag);res.setHeader('Cache-Control','no-cache');res.setHeader('Vary','Accept-Encoding');if(req.headers['if-none-match']===etag){res.writeHead(304);return res.end();}if(/(?:text|javascript|svg)/.test(mime)&&/\bgzip\b/.test(req.headers['accept-encoding']||'')){bytes=gzipSync(bytes);res.setHeader('Content-Encoding','gzip');}res.writeHead(200,{'Content-Type':mime+(mime.startsWith('text/')?'; charset=utf-8':''),'Content-Length':bytes.length});res.end(method==='HEAD'?undefined:bytes);
    }catch(error) {
      const constraint=error.code?.startsWith('ERR_SQLITE') && /constraint/i.test(error.message);
      const status=error.status || (error.code==='ENOENT'?404:constraint?409:500);
      if(status===429)res.setHeader('Retry-After','60');
      if(status===500) console.error(JSON.stringify({event:'request_failed',requestId:res.getHeader('X-Request-ID'),code:error.code||error.name}));
      if(!res.headersSent) send(status,{error:error.status?error.message:status===409?'Registro duplicado ou relacionamento inválido.':status===404?'Página inexistente.':'Serviço temporariamente indisponível.'});else res.end();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  server.on('close',()=>clearInterval(snapshotTimer));
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const db=openDatabase();const stopBackups=scheduleBackups(db);const server=createApp({db});const port=Number(process.env.PORT || 3000);
  server.listen(port,process.env.HOST || '127.0.0.1',()=>console.log(`Loja disponível na porta ${port}.`));
  for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>server.close(async()=>{await stopBackups();db.close();process.exit(0);}));
}

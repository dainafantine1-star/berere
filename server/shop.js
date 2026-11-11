import {randomUUID,randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {transaction,settings} from './db.js';
import {digest,csrfToken,hashPassword,loginThrottle} from './auth.js';
import {attachPublicCustomer,customerInput} from './customers.js';
import {quantity} from './orders.js';
import {audit} from './audit.js';
import * as v from './validation.js';

const cookieName='bereree_session';
const expiry=()=>Date.now()+7*86400000;
const owner=s=>s.user_id?`u:${s.user_id}`:`g:${s.guest_key}`;
const cookie=(token,maxAge=604800)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`;
export function content(db){const row=db.prepare('SELECT * FROM shop_content WHERE id=1').get();return {...JSON.parse(row.payload),version:row.version};}
export function saveContent(db,user,input){
  v.check(user.isOwner||user.role==='admin','Acesso restrito.',403);
  return transaction(db,()=>{
    const before=content(db);v.check(input.version===before.version,'As opções mudaram. Atualize a página.',409);
    const data={};for(const k of ['deliveryEnabled','pickupEnabled','acceptingOrders','popupEnabled'])data[k]=!!v.flag(input[k]);
    for(const k of ['deliveryFee','minimumOrder']){v.check(Number.isFinite(input[k])&&input[k]>=0&&input[k]<=100000,'Valor inválido.');data[k]=Math.round(input[k]*100)/100;}
    data.popupDelay=v.integer(input.popupDelay,0,300);data.popupIntervalHours=v.integer(input.popupIntervalHours,1,168);
    v.check(Array.isArray(input.paymentMethods)&&input.paymentMethods.length>0&&input.paymentMethods.every(p=>['dinheiro','cartao','pix'].includes(p)),'Escolha as formas de pagamento.');data.paymentMethods=[...new Set(input.paymentMethods)];
    v.check(Array.isArray(input.videos)&&input.videos.length<=50,'Limite de 50 vídeos.');data.videos=input.videos.map(item=>{const url=new URL(v.text(item.url,2000));v.check(url.protocol==='https:'&&!url.username&&!url.password,'Use URL HTTPS para o vídeo.');return {id:item.id? v.text(item.id,100):randomUUID(),title:v.text(item.title,200),url:url.href,productId:v.text(item.productId||'',100,false)};});
    db.prepare('UPDATE shop_content SET payload=?,version=version+1 WHERE id=1').run(JSON.stringify(data));audit(db,user,'app_settings_updated','company',1,before,data);return content(db);
  });
}
function session(db,req,res,create=false){
  const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  let row=token?db.prepare('SELECT * FROM shop_sessions WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now()):null;
  if(!row&&create){const value=randomBytes(32).toString('hex');row={token_hash:digest(value),user_id:null,guest_key:randomUUID(),expires_at:expiry()};db.prepare('DELETE FROM shop_sessions WHERE expires_at<=?').run(Date.now());db.prepare('INSERT INTO shop_sessions VALUES(?,?,?,?)').run(row.token_hash,row.user_id,row.guest_key,row.expires_at);res.setHeader('Set-Cookie',cookie(value));return {...row,token:value};}
  v.check(row,'Sua sessão expirou. Atualize a página.',401);return {...row,token};
}
function profile(db,s){const u=s.user_id?db.prepare('SELECT id,name AS nome,email FROM shop_users WHERE id=?').get(s.user_id):null;return {user:u,guestId:s.guest_key,identity:s.user_id||s.guest_key,csrfToken:csrfToken(s.token)};}
function iso(value){return value.includes('T')?value:value.replace(' ','T')+'Z';}
function orderDTO(db,o){return {id:o.id,protocol:o.protocol,user_id:o.owner_key?.slice(2),status:o.delivery_status,total:(o.final_total_cents??o.known_total_cents+o.shipping_cents)/100,subtotal:o.known_total_cents/100,frete:o.shipping_cents/100,data:iso(o.created_at),payment:o.payment_method,mode:o.fulfillment==='delivery'?'entrega':'retirada',address:o.fulfillment==='delivery'?JSON.parse(o.customer_snapshot).deliveryAddress:null,customer:{nome:JSON.parse(o.customer_snapshot).name,telefone:JSON.parse(o.customer_snapshot).phone,email:JSON.parse(o.customer_snapshot).email},notes:o.notes,items:db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(o.id).map(i=>({id:i.id,product_id:i.slug_snapshot,nome:i.name_snapshot,imagem_url:i.image_snapshot.startsWith('/')||i.image_snapshot.startsWith('https:')?i.image_snapshot:'/'+i.image_snapshot,unidade:i.unit_snapshot,quantidade:i.quantity,preco_unitario:i.unit_price_cents/100,codigo:i.reference_snapshot})),events:db.prepare("SELECT * FROM order_history WHERE order_id=? AND action IN ('checkout_created','delivery_status_changed') ORDER BY id").all(o.id).map(h=>({status:JSON.parse(h.data_json).status,at:iso(h.created_at)}))};}
export function createCheckout(db,s,input){
  const requestKey=v.text(input.requestKey,100);v.check(/^[a-zA-Z0-9-]{16,100}$/.test(requestKey),'Chave do pedido inválida.');
  const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex'),key=owner(s);
  return transaction(db,()=>{
    const previous=db.prepare('SELECT * FROM orders WHERE request_key=?').get(requestKey);
    if(previous){v.check(previous.owner_key===key&&previous.fingerprint===fingerprint,'Essa tentativa já foi usada em outro pedido.',409);return orderDTO(db,previous);}
    const config=content(db),company=settings(db);v.check(config.acceptingOrders,'A loja está com novos pedidos pausados.',409);
    v.check(['entrega','retirada'].includes(input.mode),'Escolha entrega ou retirada.');
    v.check(input.mode==='entrega'?config.deliveryEnabled:config.pickupEnabled,'Modalidade indisponível.',409);
    v.check(config.paymentMethods.includes(input.payment),'Forma de pagamento indisponível.',409);
    const address=input.mode==='entrega'?addressInput(input.address):null;
    const customer=customerInput({name:input.customer?.nome,phone:input.customer?.telefone,email:input.customer?.email||'',address:address?`${address.rua}, ${address.numero} — ${address.bairro}, ${address.cidade}, ${address.cep}. ${address.complemento}`:''});
    const notes=v.text(input.notes||'',2000,false);
    v.check(Array.isArray(input.items)&&input.items.length>0&&input.items.length<=100,'Informe de 1 a 100 produtos.');
    const seen=new Set(),lines=input.items.map(i=>{v.integer(i.id);v.check(!seen.has(i.id),'Produto duplicado.');seen.add(i.id);const p=db.prepare("SELECT p.* FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=? AND p.active=1 AND p.deleted_at IS NULL AND c.active=1 AND p.status!='unavailable'").get(i.id);v.check(p&&p.price_cents!==null,'Produto indisponível ou sem preço.',409);const qty=quantity(i.qty,p.unit,company.maxQuoteQuantity);v.check(p.stock_milli===null||p.stock_milli>=Math.round(qty*1000),'Estoque insuficiente. Atualize sua cesta.',409);return {...p,qty};});
    const subtotal=lines.reduce((sum,p)=>sum+Math.round(p.price_cents*p.qty),0),shipping=input.mode==='entrega'?Math.round(config.deliveryFee*100):0;
    v.check(subtotal>=Math.round(config.minimumOrder*100),'O pedido não atinge o valor mínimo.',409);
    const c=attachPublicCustomer(db,customer),id=randomUUID(),protocol='BER-'+id.slice(0,8).toUpperCase();
    const snapshot={...customer,deliveryAddress:address};
    db.prepare("INSERT INTO orders(id,request_key,customer_id,kind,status,known_total_cents,has_consultation,terms_snapshot,protocol,source,customer_snapshot,fulfillment,delivery_address,notes,fingerprint,owner_key,payment_method,shipping_cents,stock_deducted) VALUES(?,?,?,'order','pending',?,0,?,?,'app',?,?,?,?,?,?,?,?,1)").run(id,requestKey,c.id,subtotal,company.commercialTerms,protocol,JSON.stringify(snapshot),input.mode==='entrega'?'delivery':'pickup',customer.address,notes,fingerprint,key,input.payment,shipping);
    for(const p of lines){db.prepare('INSERT INTO order_items(order_id,product_id,line_key,reference_snapshot,name_snapshot,specs_snapshot,terms_snapshot,unit_price_cents,quantity,unit_snapshot,image_snapshot,slug_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,p.id,`p${p.id}`,p.sku,p.name,'{}',p.commercial_terms,p.price_cents,p.qty,p.unit,p.image,p.slug||`produto-${p.id}`);if(p.stock_milli!==null)db.prepare('UPDATE products SET stock_milli=stock_milli-?,stock=CAST(ceil((stock_milli-?)/1000.0) AS INTEGER),version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(Math.round(p.qty*1000),Math.round(p.qty*1000),p.id);}
    db.prepare("INSERT INTO order_history(order_id,action,to_stage,data_json,note) VALUES(?,'checkout_created','received',?,'Pedido recebido pelo app; pagamento a confirmar pela equipe.')").run(id,JSON.stringify({status:'recebido'}));
    return orderDTO(db,db.prepare('SELECT * FROM orders WHERE id=?').get(id));
  });
}
export function updateDelivery(db,user,id,input){return transaction(db,()=>{
  const o=db.prepare('SELECT * FROM orders WHERE id=? AND owner_key IS NOT NULL').get(id);v.check(o,'Pedido do app inexistente.',404);v.check(o.version===input.version,'Pedido alterado. Atualize a tela.',409);
  const sequence=o.fulfillment==='pickup'?['recebido','preparacao','pronto','entregue']:['recebido','preparacao','saiu_entrega','entregue'];
  const allowed=['entregue','cancelado'].includes(o.delivery_status)?[]:[sequence[sequence.indexOf(o.delivery_status)+1],'cancelado'];v.check(allowed.includes(input.status),'Mudança de status inválida.',409);
  const note=v.text(input.note||'',2000,false);v.check(input.status!=='cancelado'||note,'Informe o motivo do cancelamento.');
  if(input.status==='cancelado'&&o.stock_deducted){for(const i of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id))db.prepare('UPDATE products SET stock_milli=stock_milli+?,stock=CAST(ceil((stock_milli+?)/1000.0) AS INTEGER),version=version+1 WHERE id=? AND stock_milli IS NOT NULL').run(Math.round(i.quantity*1000),Math.round(i.quantity*1000),i.product_id);}
  const stage=input.status==='entregue'?'completed':input.status==='cancelado'?'cancelled':'in_progress',status=stage==='completed'?'completed':stage==='cancelled'?'cancelled':'negotiating';
  db.prepare('UPDATE orders SET delivery_status=?,stage=?,status=?,assigned_to=?,version=version+1,stock_deducted=CASE WHEN ?=\'cancelado\' THEN 0 ELSE stock_deducted END,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(input.status,stage,status,user.id,input.status,id);
  db.prepare("INSERT INTO order_history(order_id,actor_id,action,from_stage,to_stage,note,data_json) VALUES(?,?,'delivery_status_changed',?,?,?,?)").run(id,user.id,o.stage,stage,note,JSON.stringify({status:input.status}));audit(db,user,'delivery_status_changed','order',id,{status:o.delivery_status},{status:input.status,note});return {ok:true};
});}
function addressInput(input){v.check(input&&typeof input==='object','Informe o endereço.');const result={};for(const k of ['apelido','nome','telefone','rua','numero','bairro','cidade','cep'])result[k]=v.text(input[k],k==='telefone'?40:200);result.complemento=v.text(input.complemento||'',500,false);return result;}
export function shopRoute({db,req,res,url,input,ip}){
  const path=url.pathname,method=req.method;
  const s=session(db,req,res,path==='/api/shop/session'&&method==='GET');
  if(method!=='GET')v.check(req.headers['x-csrf-token']===csrfToken(s.token),'Atualize a sessão e tente novamente.',403);
  const key=owner(s);
  if(path==='/api/shop/session'&&method==='GET')return profile(db,s);
  if(path==='/api/shop/auth'&&method==='POST'){
    loginThrottle(db,input.email,ip);const email=v.email(input.email);v.text(input.password,200);
    return transaction(db,()=>{
      let user=db.prepare('SELECT * FROM shop_users WHERE email=?').get(email);
      if(input.register){v.check(!user,'Não foi possível criar o acesso com esses dados.',409);user={id:randomUUID(),email,name:v.text(input.nome,80),password_hash:hashPassword(input.password)};db.prepare('INSERT INTO shop_users(id,name,email,password_hash) VALUES(?,?,?,?)').run(user.id,user.name,user.email,user.password_hash);}
      else {const [salt,expected]=(user?.password_hash||`${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');v.check(timingSafeEqual(scryptSync(input.password,salt,64),Buffer.from(expected,'hex'))&&!!user,'E-mail ou senha inválidos.',401);}
      const target=`u:${user.id}`;
      // Only a guest's current session is claimed. Never transfer data between signed-in accounts.
      if(!s.user_id){db.prepare('UPDATE orders SET owner_key=? WHERE owner_key=?').run(target,key);db.prepare('UPDATE shop_addresses SET owner_key=? WHERE owner_key=?').run(target,key);const preferences=db.prepare('SELECT payload FROM shop_preferences WHERE owner_key=?').get(key);if(preferences){db.prepare('INSERT OR IGNORE INTO shop_preferences VALUES(?,?)').run(target,preferences.payload);db.prepare('DELETE FROM shop_preferences WHERE owner_key=?').run(key);}}
      const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM shop_sessions WHERE token_hash=?').run(s.token_hash);db.prepare('INSERT INTO shop_sessions VALUES(?,?,?,?)').run(digest(token),user.id,randomUUID(),expiry());res.setHeader('Set-Cookie',cookie(token));return {user:{id:user.id,nome:user.name,email:user.email},csrfToken:csrfToken(token)};
    });
  }
  if(path==='/api/shop/logout'&&method==='POST'){db.prepare('DELETE FROM shop_sessions WHERE token_hash=?').run(s.token_hash);res.setHeader('Set-Cookie',cookie('',0));return {ok:true};}
  if(path==='/api/shop/data'&&method==='GET'){
    const pref=JSON.parse(db.prepare('SELECT payload FROM shop_preferences WHERE owner_key=?').get(key)?.payload||'{}');return {...profile(db,s),favorites:pref.favorites||[],shoppingLists:pref.shoppingLists||[],settings:pref.settings||{},addresses:db.prepare('SELECT * FROM shop_addresses WHERE owner_key=?').all(key).map(a=>({...JSON.parse(a.payload),id:a.id,user_id:s.user_id||s.guest_key})),orders:db.prepare('SELECT * FROM orders WHERE owner_key=? ORDER BY created_at DESC LIMIT 200').all(key).map(o=>orderDTO(db,o))};
  }
  if(path==='/api/shop/preferences'&&method==='PUT'){v.check(Array.isArray(input.favorites)&&input.favorites.length<=1000&&input.favorites.every(x=>typeof x==='string'&&x.length<=100),'Favoritos inválidos.');v.check(Array.isArray(input.shoppingLists)&&input.shoppingLists.length<=100,'Limite de listas atingido.');const lists=input.shoppingLists.map(l=>{v.check(Array.isArray(l.items)&&l.items.length<=100,'Lista inválida.');return {id:v.text(l.id,100),nome:v.text(l.nome,80),data:v.text(l.data,80),items:l.items.map(i=>({product_id:v.text(i.product_id,100),quantidade:quantity(i.quantidade,'kg',10000)}))};});const data={favorites:[...new Set(input.favorites)],shoppingLists:lists,settings:{notifications:!!input.settings?.notifications}};db.prepare('INSERT INTO shop_preferences VALUES(?,?) ON CONFLICT(owner_key) DO UPDATE SET payload=excluded.payload').run(key,JSON.stringify(data));return data;}
  if(path==='/api/shop/addresses'&&method==='POST'){const a=addressInput(input),id=randomUUID();v.check(db.prepare('SELECT count(*) AS n FROM shop_addresses WHERE owner_key=?').get(key).n<50,'Limite de endereços atingido.');db.prepare('INSERT INTO shop_addresses VALUES(?,?,?)').run(id,key,JSON.stringify(a));return {...a,id,user_id:s.user_id||s.guest_key};}
  if(path.startsWith('/api/shop/addresses/')&&method==='DELETE'){db.prepare('DELETE FROM shop_addresses WHERE id=? AND owner_key=?').run(path.split('/').at(-1),key);return {ok:true};}
  if(path==='/api/shop/orders'&&method==='POST')return createCheckout(db,s,input);
  throw new v.HttpError(404,'Endpoint inexistente.');
}

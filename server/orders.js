import { randomUUID,createHash } from 'node:crypto';
import { transaction,settings } from './db.js';
import * as v from './validation.js';
import { attachPublicCustomer,customerInput } from './customers.js';
import { audit } from './audit.js';
const money=cents=>cents===null?'Sob consulta':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export const stages={received:'Recebido',in_progress:'Em atendimento',awaiting_approval:'Aguardando aprovação',approved:'Aprovado',completed:'Concluído',cancelled:'Cancelado'};
const transitions={received:['in_progress','cancelled'],in_progress:['awaiting_approval','cancelled'],awaiting_approval:['in_progress','approved','cancelled'],approved:['in_progress','completed','cancelled'],completed:[],cancelled:[]};
export function quantity(value,unit,max=10000){v.check(typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=max,'Quantidade fora do limite.');v.check(Math.abs(value*1000-Math.round(value*1000))<0.000001,'Use até três casas decimais.');v.check(['kg','g'].includes(unit)||Number.isInteger(value),'Unidades e pacotes exigem quantidades inteiras.');return Math.round(value*1000)/1000;}
export function createQuote(db,input,{actor=null}={}) {
  const requestKey=v.text(input.requestKey,100);v.check(/^[a-zA-Z0-9-]{16,100}$/.test(requestKey),'Chave de solicitação inválida.');
  v.check(Array.isArray(input.items)&&input.items.length>=1&&input.items.length<=100,'Informe de 1 a 100 itens.');
  const seen=new Set();const items=input.items.map(i=>{
    v.check(i&&typeof i==='object','Item inválido.');v.integer(i.id);v.check(typeof i.qty==='number'&&Number.isFinite(i.qty)&&i.qty>0&&i.qty<=10000&&Math.abs(i.qty*1000-Math.round(i.qty*1000))<0.000001,'Quantidade inválida.');
    const lineKey=v.text(i.lineKey || `p${i.id}`,80);v.check(/^[a-zA-Z0-9-]+$/.test(lineKey),'Identificador de item inválido.');v.check(!seen.has(lineKey),'Item duplicado.');seen.add(lineKey);
    return {id:i.id,qty:Math.round(i.qty*1000)/1000,lineKey,measures:v.text(i.measures || '',500,false),specifications:v.text(i.specifications || '',1000,false)};
  }).sort((a,b)=>a.lineKey.localeCompare(b.lineKey));
  let contact;
  if(actor&&input.customerId){const c=db.prepare('SELECT * FROM customers WHERE id=?').get(v.integer(input.customerId));v.check(c,'Cliente inexistente.',404);contact=customerInput(c);}
  else {v.check(input.customer&&typeof input.customer==='object','Informe seu nome e contato para receber atendimento.');contact=customerInput(input.customer);}
  const fulfillment=input.fulfillment || 'pickup';v.check(['pickup','delivery'].includes(fulfillment),'Escolha retirada ou entrega.');
  const address=v.text(input.deliveryAddress || '',1000,false);v.check(fulfillment!=='delivery'||address,'Informe o endereço para entrega.');const notes=v.text(input.notes || '',2000,false);
  if(fulfillment==='delivery'&&!contact.address)contact.address=address;
  const fingerprint=createHash('sha256').update(JSON.stringify({items,contact,fulfillment,address,notes})).digest('hex');
  return transaction(db,()=>{
    const previous=db.prepare('SELECT * FROM orders WHERE request_key=?').get(requestKey);
    if(previous){v.check(previous.fingerprint===fingerprint,'A chave já foi usada em outra solicitação.',409);return quoteResponse(db,previous.id);}
    const company=settings(db),totals=new Map();
    const lines=items.map(i=>{
      const p=db.prepare("SELECT p.* FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=? AND p.active=1 AND p.deleted_at IS NULL AND p.status!='unavailable' AND (p.stock_milli IS NULL OR p.stock_milli>0) AND c.active=1").get(i.id);
      v.check(p,'Produto indisponível. Atualize o catálogo.',409);quantity(i.qty,p.unit,company.maxQuoteQuantity);
      totals.set(p.id,(totals.get(p.id)||0)+Math.round(i.qty*1000));v.check(p.stock_milli===null||p.stock_milli>=totals.get(p.id),'Quantidade maior que o estoque disponível. Atualize seu orçamento.',409);
      return {...p,...i,productId:p.id};
    });
    const customer=actor&&input.customerId?{id:input.customerId,snapshot:contact}:attachPublicCustomer(db,contact);
    const id=randomUUID(),date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Bahia'}).format(new Date()).replaceAll('-','');
    const protocol=`BER-${date}-${id.replaceAll('-','').slice(0,12).toUpperCase()}`;
    const total=lines.reduce((n,p)=>n+(p.price_cents===null?0:Math.round(p.price_cents*p.qty)),0),hasConsultation=lines.some(p=>p.price_cents===null);
    const terms=`${company.commercialTerms}\nEntrega: ${company.delivery}\nRegião: ${company.region}\nPagamento: ${company.payment}`;
    db.prepare("INSERT INTO orders(id,request_key,customer_id,kind,known_total_cents,has_consultation,terms_snapshot,protocol,source,customer_snapshot,fulfillment,delivery_address,notes,fingerprint) VALUES(?,?,?,'quote',?,?,?,?,?,?,?,?,?,?)").run(id,requestKey,customer.id,total,Number(hasConsultation),terms,protocol,actor?'admin':'storefront',JSON.stringify(customer.snapshot),fulfillment,address,notes,fingerprint);
    for(const p of lines) db.prepare('INSERT INTO order_items(order_id,product_id,line_key,reference_snapshot,name_snapshot,specs_snapshot,terms_snapshot,unit_price_cents,quantity,unit_snapshot,custom_measures,custom_specs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,p.productId,p.lineKey,p.reference,p.name,JSON.stringify({...JSON.parse(p.specs_json),SKU:p.sku,Embalagem:p.dimensions || 'Conforme catálogo','Unidade de cobrança':p.unit}),p.commercial_terms,p.price_cents,p.qty,p.unit,p.measures,p.specifications);
    db.prepare("INSERT INTO order_history(order_id,actor_id,action,to_stage,note) VALUES(?,?,'created','received',?)").run(id,actor?.id || null,actor?'Cadastro pela equipe.':'Solicitação registrada pela loja.');
    db.prepare("INSERT INTO events(name,order_id) VALUES('quote_created',?)").run(id);
    if(actor)audit(db,actor,'quote_created','order',id,null,{protocol,customerId:customer.id,total});
    return quoteResponse(db,id);
  });
}
export function quoteResponse(db,id){
  const order=db.prepare('SELECT * FROM orders WHERE id=?').get(id),items=db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(id),contact=JSON.parse(order.customer_snapshot);
  let message=`${settings(db).whatsappMessage}\nSolicitação de orçamento registrada.\nProtocolo: ${order.protocol}\nNome: ${contact.name || ''}\nContato: ${contact.phone || ''}\n\n`;
  for(const i of items)message+=`${i.name_snapshot}\nReferência: ${i.reference_snapshot}\nCaracterísticas: ${Object.entries(JSON.parse(i.specs_snapshot)).map(([k,v])=>`${k}: ${v}`).join('; ')}\nApresentação solicitada: ${i.custom_measures || 'Conforme catálogo'}\nEspecificações solicitadas: ${i.custom_specs || 'Conforme catálogo'}\nQuantidade: ${i.quantity} ${i.unit_snapshot}\nPreço unitário estimado: ${money(i.unit_price_cents)}\nCondição comercial: ${i.terms_snapshot}\n\n`;
  message+=order.has_consultation&&order.known_total_cents===0?'Total: Sob consulta':`${order.has_consultation?'Subtotal dos itens com preço':'Total estimado'}: ${money(order.known_total_cents)}`;
  message+=`${order.has_consultation?'\nHá itens sob consulta; total final a confirmar.':''}\n${order.fulfillment==='delivery'?'Entrega: '+order.delivery_address:'Retirada na loja'}\n${order.notes}\n${order.terms_snapshot}\nAguardando confirmação da equipe.`;
  const company=settings(db);return {id,protocol:order.protocol,message,total:order.has_consultation?null:order.known_total_cents/100,knownSubtotal:order.known_total_cents/100,hasConsultation:!!order.has_consultation,whatsapp:company.whatsapp,registered:true};
}
export function orderDetail(db,id){const order=db.prepare('SELECT o.*,u.email AS assignee_email FROM orders o LEFT JOIN admin_users u ON u.id=o.assigned_to WHERE o.id=?').get(id);v.check(order,'Solicitação inexistente.',404);return {...order,customer:JSON.parse(order.customer_snapshot),items:db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(id),history:db.prepare('SELECT h.*,u.email AS actor_email FROM order_history h LEFT JOIN admin_users u ON u.id=h.actor_id WHERE order_id=? ORDER BY h.id').all(id),allowedTransitions:transitions[order.stage]};}
export function orderList(db,url){
  const q=url.searchParams,page=v.integer(Number(q.get('page')||1),1,100000),where=['1=1'],args=[];
  if(q.get('q')){const term='%'+v.text(q.get('q'),200).replace(/[\\%_]/g,'\\$&')+'%';where.push("(o.protocol LIKE ? ESCAPE '\\' OR o.customer_snapshot LIKE ? ESCAPE '\\')");args.push(term,term);}
  if(q.get('stage')){v.check(Object.hasOwn(stages,q.get('stage')),'Estágio inválido.');where.push('o.stage=?');args.push(q.get('stage'));}
  if(q.get('assigned')){if(q.get('assigned')==='none')where.push('o.assigned_to IS NULL');else{where.push('o.assigned_to=?');args.push(v.integer(Number(q.get('assigned'))));}}
  const clause=where.join(' AND ');return {items:db.prepare(`SELECT o.*,u.email AS assignee_email FROM orders o LEFT JOIN admin_users u ON u.id=o.assigned_to WHERE ${clause} ORDER BY o.created_at DESC,o.id LIMIT 20 OFFSET ?`).all(...args,(page-1)*20),total:db.prepare(`SELECT count(*) AS n FROM orders o WHERE ${clause}`).get(...args).n,page,stages};
}
export function updateOrder(db,user,id,input){return transaction(db,()=>{
  const before=orderDetail(db,id);v.check(input.version===before.version,'O atendimento mudou. Atualize a tela.',409);
  v.check(!before.owner_key,'Use o fluxo de separação e entrega para pedidos do app.',409);
  v.check(!['completed','cancelled'].includes(before.stage),'Atendimento encerrado não pode ser alterado.',409);
  const stage=input.stage || before.stage;v.check(Object.hasOwn(stages,stage),'Estágio inválido.');if(stage!==before.stage)v.check(transitions[before.stage].includes(stage),'Transição de estágio não permitida.',409);
  const assigned=input.assignedTo===undefined?before.assigned_to:input.assignedTo;
  if(assigned!==null)v.check(db.prepare('SELECT 1 FROM admin_users WHERE id=? AND active=1').get(v.integer(assigned)),'Responsável indisponível.');
  const final=input.finalTotal===undefined?before.final_total_cents:v.money(input.finalTotal);
  if(before.stage==='approved'&&final!==before.final_total_cents)v.check(stage==='in_progress','Retorne a Em atendimento para renegociar um valor já aprovado.',409);
  v.check(!['approved','completed'].includes(stage)||final!==null,'Informe o valor fechado antes de aprovar.');
  v.check(stage!=='completed'||assigned!==null,'Atribua um responsável antes de concluir.');
  const note=v.text(input.note || '',2000,false);v.check(stage!=='cancelled'||note,'Informe o motivo do cancelamento.');
  if(input.customerId!==undefined){v.integer(input.customerId);v.check(db.prepare('SELECT 1 FROM customers WHERE id=?').get(input.customerId),'Cliente inexistente.');}
  const status={received:'pending',in_progress:'negotiating',awaiting_approval:'negotiating',approved:'confirmed',completed:'completed',cancelled:'cancelled'}[stage];
  db.prepare("UPDATE orders SET stage=?,status=?,kind=?,assigned_to=?,final_total_cents=?,customer_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP,completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,cancelled_at=CASE WHEN ?='cancelled' THEN CURRENT_TIMESTAMP ELSE cancelled_at END WHERE id=?").run(stage,status,['approved','completed'].includes(stage)?'order':'quote',assigned,final,input.customerId ?? before.customer_id,stage,stage,id);
  db.prepare('INSERT INTO order_history(order_id,actor_id,action,from_stage,to_stage,note,data_json) VALUES(?,?,?,?,?,?,?)').run(id,user.id,stage===before.stage?'updated':'stage_changed',before.stage,stage,note,JSON.stringify({assignedTo:assigned,finalTotalCents:final,previousFinalTotalCents:before.final_total_cents}));
  audit(db,user,'order_updated','order',id,{stage:before.stage,assignedTo:before.assigned_to,finalTotalCents:before.final_total_cents},{stage,assignedTo:assigned,finalTotalCents:final,note});return orderDetail(db,id);
});}

import { orderDetail,orderList,updateOrder,createQuote } from './orders.js';
import { customerList,customerDetail,saveCustomer } from './customers.js';
import { publicSettings,saveSettings,saveBanner } from './company.js';
import * as v from './validation.js';

export function commerce({db,user,req,url,p}){
  const path=url.pathname,method=req.method,ok=data=>({status:200,data});
  if(path==='/api/admin/assignees'&&method==='GET')return ok(db.prepare('SELECT id,email FROM admin_users WHERE active=1 ORDER BY is_owner DESC,email').all());
  if(path==='/api/admin/orders'&&method==='GET')return ok(orderList(db,url));
  if(path==='/api/admin/orders'&&method==='POST')return {status:201,data:createQuote(db,p,{actor:user})};
  const order=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})$/);
  if(order&&method==='GET')return ok(orderDetail(db,order[1]));
  if(order&&method==='PUT')return ok(updateOrder(db,user,order[1],p));
  if(path==='/api/admin/customers'&&method==='GET')return ok(customerList(db,url));
  if(path==='/api/admin/customers'&&method==='POST')return {status:201,data:saveCustomer(db,user,p)};
  const customer=path.match(/^\/api\/admin\/customers\/(\d+)$/);
  if(customer&&method==='GET')return ok(customerDetail(db,Number(customer[1])));
  if(customer&&method==='PUT')return ok(saveCustomer(db,user,p,Number(customer[1])));
  if(path==='/api/admin/settings'&&method==='GET'){v.check(user.isOwner||user.role==='admin','Acesso restrito.',403);return ok(publicSettings(db));}
  if(path==='/api/admin/settings'&&method==='PUT')return ok(saveSettings(db,user,p));
  if(path==='/api/admin/banners'&&method==='GET')return ok(db.prepare('SELECT * FROM banners ORDER BY sort_order,id').all());
  if(path==='/api/admin/banners'&&method==='POST')return {status:201,data:saveBanner(db,user,p)};
  const banner=path.match(/^\/api\/admin\/banners\/(\d+)$/);
  if(banner&&method==='PUT')return ok(saveBanner(db,user,p,Number(banner[1])));
  return null;
}

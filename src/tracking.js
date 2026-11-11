let sessionKey;
export function track(name,productIds=[],origin='storefront'){
 try{
  sessionKey||=sessionStorage.getItem('bereree-event-session')||crypto.randomUUID();sessionStorage.setItem('bereree-event-session',sessionKey);
  void fetch('/api/events',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,productIds,origin,sessionKey,eventKey:crypto.randomUUID()})}).catch(()=>{});
 }catch{}
}

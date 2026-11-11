import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import {track} from './tracking';
export const imageUrl=value=>!value?'':value.startsWith('/')||value.startsWith('https:')?value:'/'+value;

export const cents=n=>Math.round(Number(n)*100);
export const formatMoney=n=>n==null?'Sob consulta':Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const cartCount=cart=>Math.round(Object.values(cart).reduce((a,b)=>a+b,0)*1000)/1000;
export function cartSubtotal(cart,products=[]){return products.reduce((sum,p)=>sum+Math.round(cents(p.preco)*(cart[p.id]||0)),0)/100;}
export const quantityStep=p=>['kg','g'].includes(p?.unit)?0.25:1;
export function validatedQuantity(product,current,delta){if(!product||!Number.isFinite(delta))return current;return Math.round(Math.max(0,Math.min(99,product.estoque,current+delta))*1000)/1000;}
export function restoreCart(value){if(!value||typeof value!=='object'||Array.isArray(value))return {};return Object.fromEntries(Object.entries(value).filter(([id,qty])=>/^[a-z0-9-]{1,100}$/.test(id)&&typeof qty==='number'&&Number.isFinite(qty)&&qty>0&&qty<=99&&Math.abs(qty*1000-Math.round(qty*1000))<0.000001));}
let csrf='',loading=null,preferenceQueue=Promise.resolve(),generation=0;
export async function api(path,method='GET',data){
  const response=await fetch('/api/'+path,{method,credentials:'same-origin',cache:'no-store',headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Não foi possível concluir.');return result;
}
function publicData(data){return {products:data.products.map(p=>({id:p.slug,api_id:p.id,nome:p.name,descricao:p.description,preco:p.price,preco_anterior:p.oldPrice,categoria_id:p.category,imagem_url:imageUrl(p.image),estoque:p.available&&p.price!==null?(p.stock??data.settings.maxQuoteQuantity):0,unit:p.unit,unidade:p.unit==='kg'?'kg':p.unit==='g'?'g':p.dimensions||({maco:'maço',bandeja:'bandeja',pacote:'pacote'}[p.unit]||'unidade'),oferta:p.offer,codigo:p.sku,avaliacao:0,vendidos:0})),categories:data.categories.map(c=>({id:c.id,nome:c.label,icone_url:imageUrl(c.image),cor:c.color,descricao:c.description})),banners:data.banners,company:{...data.settings,logo:imageUrl(data.settings.logo),heroImage:imageUrl(data.settings.heroImage)},appSettings:data.app,adminSettings:{whatsapp:data.settings.whatsapp},productVideos:data.app.videos.map(v=>({...v,product_id:v.productId}))};}
function privateData(data){csrf=data.csrfToken;return {user:data.user,guestId:data.guestId,orders:data.orders,addresses:data.addresses,favorites:data.favorites,shoppingLists:data.shoppingLists,settings:data.settings};}
async function savePreferences(get,set){const s=get(),payload={favorites:s.favorites,shoppingLists:s.shoppingLists,settings:s.settings};preferenceQueue=preferenceQueue.catch(()=>{}).then(()=>api('shop/preferences','PUT',payload));try{await preferenceQueue;}catch(error){set({syncError:error.message});throw error;}}
export const useShop=create(persist((set,get)=>({
  products:[],categories:[],banners:[],company:{},appSettings:{paymentMethods:[]},cart:{},favorites:[],orders:[],addresses:[],user:null,guestId:'',welcomed:false,checkout:{mode:'retirada',address:null,payment:'dinheiro',notes:''},settings:{notifications:false},shoppingLists:[],adminSettings:{whatsapp:''},productVideos:[],ready:false,loadError:'',syncError:'',requestKey:null,
  initialize:()=>{if(loading)return loading;loading=(async()=>{try{const [catalog]=await Promise.all([api('catalog'),api('shop/session')]);const data=await api('shop/data');set({...publicData(catalog),...privateData(data),ready:true,loadError:''});track('catalog_view');}catch(error){set({loadError:error.message,ready:false});}finally{loading=null;}})();return loading;},
  refresh:async()=>{const currentGeneration=generation;try{const [catalog,data]=await Promise.all([api('catalog'),api('shop/data')]);if(currentGeneration!==generation)return;const identityChanged=get().user?.id!==data.user?.id;set({...publicData(catalog),...privateData(data),syncError:'',...(identityChanged?{cart:{},checkout:{mode:'retirada',address:null,payment:'dinheiro',notes:''},requestKey:null}:{})});}catch(error){set({syncError:error.message});}},
  welcome:()=>set({welcomed:true}),
  add:(id,delta=1)=>{const s=get(),p=s.products.find(p=>p.id===id);if(!p)return false;const next=validatedQuantity(p,s.cart[id]||0,delta),cart={...s.cart};if(next)cart[id]=next;else delete cart[id];set({cart,requestKey:null});return next>0;},
  favorite:async id=>{set(s=>({favorites:s.favorites.includes(id)?s.favorites.filter(x=>x!==id):[...s.favorites,id]}));await savePreferences(get,set);},
  setCheckout:value=>set(s=>({checkout:{...s.checkout,...value},requestKey:null})),
  identity:()=>get().user?.id||get().guestId,
  login:async(nome,email,password,register=false)=>{await preferenceQueue.catch(()=>{});generation++;const data=await api('shop/auth','POST',{nome,email,password,register});csrf=data.csrfToken;set({user:data.user,checkout:{mode:'retirada',address:null,payment:'dinheiro',notes:''},requestKey:null});const state=await api('shop/data');set({...privateData(state),welcomed:true});},
  logout:async()=>{await preferenceQueue.catch(()=>{});generation++;await api('shop/logout','POST',{});set({user:null,orders:[],addresses:[],favorites:[],shoppingLists:[],settings:{},cart:{},checkout:{mode:'retirada',address:null,payment:'dinheiro',notes:''},requestKey:null,ready:false});await get().initialize();},
  saveAddress:async address=>{const a=await api('shop/addresses','POST',address);set(s=>({addresses:[...s.addresses,a]}));return a;},
  removeAddress:async id=>{await api('shop/addresses/'+encodeURIComponent(id),'DELETE',{});set(s=>({addresses:s.addresses.filter(x=>x.id!==id),checkout:{...s.checkout,address:s.checkout.address?.id===id?null:s.checkout.address}}));},
  placeOrder:async()=>{const s=get();if(!cartCount(s.cart))throw Error('Sua cesta está vazia.');const items=Object.entries(s.cart).map(([id,qty])=>{const p=s.products.find(p=>p.id===id);if(!p)throw Error('Um produto saiu do catálogo. Revise sua cesta.');return {id:p.api_id,qty};});const requestKey=s.requestKey||crypto.randomUUID();set({requestKey});const order=await api('shop/orders','POST',{requestKey,items,mode:s.checkout.mode,address:s.checkout.address,payment:s.checkout.payment,notes:s.checkout.notes,customer:{nome:s.checkout.customerName||s.checkout.address?.nome||s.user?.nome||'',telefone:s.checkout.customerPhone||s.checkout.address?.telefone||'',email:s.user?.email||''}});generation++;set({orders:[order,...s.orders.filter(o=>o.id!==order.id)],cart:{},requestKey:null,checkout:{...s.checkout,notes:''}});void get().refresh();return order;},
  saveList:async(nome,items)=>{const list={id:crypto.randomUUID(),nome,items,data:new Date().toISOString()};set(s=>({shoppingLists:[list,...s.shoppingLists]}));await savePreferences(get,set);return list;},
  removeList:async id=>{set(s=>({shoppingLists:s.shoppingLists.filter(l=>l.id!==id)}));await savePreferences(get,set);},
  setSettings:async values=>{set(s=>({settings:{...s.settings,...values}}));await savePreferences(get,set);}
}),{name:'bereree-app-v4',version:1,partialize:s=>({cart:s.cart,welcomed:s.welcomed,requestKey:s.requestKey}),merge:(saved,current)=>({...current,cart:restoreCart(saved?.cart),welcomed:saved?.welcomed===true,requestKey:typeof saved?.requestKey==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(saved.requestKey)?saved.requestKey:null})}));

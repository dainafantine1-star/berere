import React,{useState,useEffect,useRef} from 'react';
import {Link} from 'react-router-dom';
import {useShop,formatMoney} from './store';

const PROMO_SESSION='bereree-popup-session';
const COUPON_NEXT='bereree-coupon-next';
const COUPON_INTERVAL=5*60*1000;
const COUPON_CODE='BERE5';

function useDialogFocus(open,dialog){
 const previous=useRef(null);
 useEffect(()=>{
   if(!open)return;
   dialog.current?.focus();
   const before=document.body.style.overflow;
   document.body.style.overflow='hidden';
   return()=>{document.body.style.overflow=before;previous.current?.focus();};
 },[open,dialog]);
}

// Ofertas da loja: uma vez por sessão, logo após entrar na área de compra.
export function PromotionPopup(){
 const config=useShop(s=>s.appSettings),products=useShop(s=>s.products),[open,setOpen]=useState(false),dialog=useRef(null),previous=useRef(null),offers=products.filter(p=>p.oferta&&p.estoque>0).slice(0,2);
 useDialogFocus(open,dialog);
 useEffect(()=>{
   if(!config.popupEnabled||!offers.length)return;
   let seen=false;try{seen=sessionStorage.getItem(PROMO_SESSION)==='1'}catch{}
   if(seen)return;
   const timer=setTimeout(()=>{
     try{sessionStorage.setItem(PROMO_SESSION,'1')}catch{}
     previous.current=document.activeElement;setOpen(true);
   },(config.popupDelay||3)*1000);
   return()=>clearTimeout(timer);
 },[config.popupEnabled,config.popupDelay,offers.length]);
 if(!open||!config.popupEnabled||!offers.length)return null;
 return <div className="promotion-overlay" onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}><section className="promotion-dialog" role="dialog" aria-modal="true" aria-labelledby="promotion-title" ref={dialog} tabIndex={-1} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);if(e.key==='Tab'){const items=dialog.current.querySelectorAll('button,a'),first=items[0],last=items[items.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}><button className="promotion-close" aria-label="Fechar promoção" onClick={()=>setOpen(false)}>×</button><header><small>BERÊRÊ</small><h2 id="promotion-title">OFERTAS DA SEMANA</h2></header>{offers.map(p=><div className="promotion-item" key={p.id}><img src={p.imagem_url} alt={p.nome}/><div><h3>{p.nome} <small>{p.unidade}</small></h3><strong>{formatMoney(p.preco)}</strong></div></div>)}<Link className="promotion-cta" to="/ofertas" onClick={()=>setOpen(false)}>Ver ofertas do mercado</Link></section></div>;
}

// Cupom surpresa a cada 5 minutos enquanto o cliente navega pela loja.
export function CouponPopup(){
 const [open,setOpen]=useState(false),[copied,setCopied]=useState(false),dialog=useRef(null),previous=useRef(null);
 useDialogFocus(open,dialog);
 useEffect(()=>{
   let timer;
   const fire=()=>{
     if(document.querySelector('.promotion-overlay')){timer=setTimeout(fire,15000);return;}
     previous.current=document.activeElement;setCopied(false);setOpen(true);
     try{localStorage.setItem(COUPON_NEXT,String(Date.now()+COUPON_INTERVAL))}catch{}
     timer=setTimeout(fire,COUPON_INTERVAL);
   };
   let next=0;try{next=Number(localStorage.getItem(COUPON_NEXT)||0)}catch{}
   timer=setTimeout(fire,Math.max(5000,next-Date.now()));
   return()=>clearTimeout(timer);
 },[]);
 if(!open)return null;
 const copy=async()=>{
   try{await navigator.clipboard.writeText(COUPON_CODE);setCopied(true);}catch{}
 };
 return <div className="promotion-overlay" onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}><section className="promotion-dialog coupon-dialog" role="dialog" aria-modal="true" aria-labelledby="coupon-title" ref={dialog} tabIndex={-1} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}><button className="promotion-close" aria-label="Fechar cupom" onClick={()=>setOpen(false)}>×</button><header><small>CUPOM EXCLUSIVO DO APP</small><h2 id="coupon-title">5% OFF</h2><span>NA SUA PRÓXIMA COMPRA</span></header><strong className="coupon-code">{COUPON_CODE}</strong><button className="promotion-cta" onClick={copy}>{copied?'CUPOM COPIADO!':'Copiar cupom'}</button><p className="coupon-note">Cole o código nas observações do pedido ou mostre na retirada. Válido uma vez por cliente.</p><p className="coupon-copied" aria-live="polite">{copied?'Código copiado — é só colar no pedido.':''}</p></section></div>;
}

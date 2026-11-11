import React,{useState,useEffect,useRef} from 'react';
import {useShop} from './store';

const LETTER_MS=150;
const HOLD_MS=950;

// Abertura com o nome digitado letra a letra e um brilho percorrendo o texto.
export function Splash({onDone}){
 const company=useShop(s=>s.company);
 const nameRef=useRef('BERÊRÊ');
 nameRef.current=(company.name||'Berêrê').toUpperCase();
 const doneRef=useRef(onDone);
 useEffect(()=>{doneRef.current=onDone;},[onDone]);
 const [typed,setTyped]=useState(0),[shining,setShining]=useState(false),[leaving,setLeaving]=useState(false);
 useEffect(()=>{
   const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
   const finish=()=>doneRef.current();
   let timers=[];
   if(reduce){
     setTyped(nameRef.current.length);setShining(true);
     timers.push(setTimeout(()=>setLeaving(true),350),setTimeout(finish,750));
     return()=>timers.forEach(clearTimeout);
   }
   let i=0;
   const tick=setInterval(()=>{
     i++;setTyped(i);
     if(i>=nameRef.current.length){
       clearInterval(tick);
       timers.push(
         setTimeout(()=>setShining(true),120),
         setTimeout(()=>setLeaving(true),HOLD_MS),
         setTimeout(finish,HOLD_MS+520),
       );
     }
   },LETTER_MS);
   return()=>{clearInterval(tick);timers.forEach(clearTimeout)};
 },[]);
 const name=nameRef.current;
 const done=typed>=name.length;
 return <div className={'splash'+(leaving?' leaving':'')} role="status" aria-label="Abrindo o Berêrê">
   <div className="splash-core">
     <img className="splash-logo" src={company.logo||'/bereree-logo.png'} alt="" width="112" height="112"/>
     <div className={'splash-name'+(shining?' shining':'')} aria-hidden="true">
       {name.slice(0,typed)}{!done&&<span className="splash-caret"/>}
     </div>
   </div>
   <span className="splash-tag">ATACADÃO · ITABERABA</span>
 </div>;
}

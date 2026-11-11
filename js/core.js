// Shared administrative rendering helpers.
globalThis.StoreCore=Object.freeze({
 escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
 image(value){return typeof value==='string'&&(/^https:\/\/[^\s]+$/i.test(value)||/^\/[a-z0-9_-]+\.(png|jpe?g|webp|svg)$/i.test(value)||/^uploads\/[a-f0-9-]{36}\.webp$/.test(value))?value:'';},
 step(unit){return ['kg','g'].includes(unit)?0.001:1;}
});

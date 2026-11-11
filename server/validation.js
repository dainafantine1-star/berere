export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function check(condition, message = 'Dados inválidos.', status = 400) { if (!condition) throw new HttpError(status, message); }
export function text(value, max = 200, required = true) {
  check(typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0), 'Texto inválido.');
  return value.trim();
}
export function integer(value, min = 1, max = 2147483647) { check(Number.isSafeInteger(value) && value >= min && value <= max, 'Número inteiro inválido.'); return value; }
export function money(value) { if (value === null) return null; check(typeof value === 'number' && Number.isFinite(value) && value>0 && value<=10000000 && Math.abs(value*100-Math.round(value*100))<0.00001, 'Preço inválido. Use null para sob consulta.'); return Math.round(value*100); }
export function slug(value) { check(typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value), 'Identificador inválido.'); return value; }
export function flag(value) { check(typeof value === 'boolean', 'Valor booleano inválido.'); return Number(value); }
export function specs(value) {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length<=30, 'Características inválidas.');
  for (const [k,v] of Object.entries(value)) { text(k,100); text(v,500); }
  return JSON.stringify(value);
}
export function image(value) { text(value,2000,false); check(value === '' || /^https:\/\/[^\s]+$/i.test(value) || /^\/[a-z0-9_-]+\.(png|jpg|jpeg|webp|svg)$/i.test(value) || /^(?:images|assets)\/[a-z0-9/_.-]+$/i.test(value) || /^uploads\/[a-f0-9-]{36}\.webp$/.test(value), 'URL de imagem inválida.'); return value; }
export function email(value) { const result = text(value,254).toLowerCase(); check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result), 'E-mail inválido.'); return result; }
export function validWhatsapp(value) { return typeof value === 'string' && /^55[1-9]{2}9?[1-9][0-9]{7}$/.test(value); }
export function company(value) {
  check(value && typeof value === 'object', 'Configuração inválida.');
  const result = {};
  for (const key of ['name','phone','address','hours','delivery','payment','commercialTerms']) result[key] = text(value[key],2000);
  result.whatsapp = text(value.whatsapp,20,false); result.confirmed = !!flag(value.confirmed);
  check(!result.confirmed || validWhatsapp(result.whatsapp), 'Informe um WhatsApp válido para confirmar os dados.');
  return result;
}

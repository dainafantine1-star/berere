import { isIP } from 'node:net';
const normalize=value=>value?.startsWith('::ffff:')?value.slice(7):value;
export function clientAddress(req,trusted=process.env.TRUST_PROXY_IP){
  const peer=normalize(req.socket.remoteAddress);
  if(!trusted||peer!==normalize(trusted))return peer;
  const header=req.headers['x-forwarded-for'];
  if(typeof header!=='string'||header.length>2048)return peer;
  const candidate=normalize(header.split(',').at(-1).trim());
  return isIP(candidate)?candidate:peer;
}

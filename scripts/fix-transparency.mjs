import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Remove fundo sólido por preenchimento a partir das bordas, com teste de cor da
// família do fundo e limite de gradiente entre vizinhos — o objeto só é cortado
// onde a cor muda, preservando o miolo (ex.: gordura branca dentro da carne).
async function removeBackground(name, { isBg, nearMax }) {
  const { data, info } = await sharp(`${DIR}/${name}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const idx = (x, y) => (y * w + x) * c;
  const rgb = i => [data[i], data[i + 1], data[i + 2]];
  const mask = new Uint8Array(w * h);
  const queue = [];
  const seed = (x, y) => {
    const p = y * w + x;
    if (mask[p]) return;
    const i = idx(x, y);
    if (data[i + 3] === 0 || isBg(...rgb(i))) { mask[p] = 1; queue.push(p); }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  for (let p = 0; p < w * h; p++) if (data[idx(p % w, (p / w) | 0) + 3] === 0) { mask[p] = 1; queue.push(p); }
  const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= nearMax;
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head], x = p % w, y = (p / w) | 0, ci = rgb(idx(x, y));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const np = ny * w + nx;
      if (mask[np]) continue;
      const i = idx(nx, ny), cn = rgb(i);
      if (data[i + 3] === 0 || (isBg(...cn) && near(ci, cn))) { mask[np] = 1; queue.push(np); }
    }
  }
  // cor média do fundo removido (para desmisturar a borda)
  let br = 0, bg = 0, bb = 0, bn = 0;
  for (let p = 0; p < w * h; p++) if (mask[p] && data[idx(p % w, (p / w) | 0) + 3] !== 0) {
    const i = idx(p % w, (p / w) | 0); br += data[i]; bg += data[i + 1]; bb += data[i + 2]; bn++;
  }
  const bgc = bn ? [br / bn, bg / bn, bb / bn] : [255, 255, 255];
  // alfa: fundo = 0; objeto = 255; borda recebe cobertura 3x3 (antisserrilhado)
  const out = Buffer.alloc(w * h * 4);
  const cov = (x, y) => {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      s += mask[ny * w + nx]; n++;
    }
    return s / n;
  };
  let removed = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = idx(x, y), o = p * 4;
    if (mask[p]) { out[o + 3] = 0; removed++; continue; }
    const m = cov(x, y);
    const a = m > 0 ? Math.round((1 - m) * 255) : 255;
    let r = data[i], g = data[i + 1], b = data[i + 2];
    if (a > 0 && a < 255) { // desmistura: remove resíduo da cor de fundo
      const k = a / 255;
      r = Math.max(0, Math.min(255, (r - (1 - k) * bgc[0]) / k));
      g = Math.max(0, Math.min(255, (g - (1 - k) * bgc[1]) / k));
      b = Math.max(0, Math.min(255, (b - (1 - k) * bgc[2]) / k));
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
  await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(`${DIR}/${name}`);
  console.log(`${name}: fundo removido em ${removed} px (${Math.round(100 * removed / (w * h))}%)`);
}

// Halo de borda: pixels semi-transparentes colados em transparência viram 0 ou 255,
// eliminando o resquício branco fantasma sem tocar no miolo do objeto.
async function snapEdgeHalo(name) {
  const { data, info } = await sharp(`${DIR}/${name}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const i = (x, y) => (y * w + x) * c + 3;
  let changed = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = i(x, y), a = data[p];
    if (a === 0 || a === 255) continue;
    const edge = (x > 0 && data[i(x - 1, y)] === 0) || (x < w - 1 && data[i(x + 1, y)] === 0) ||
                 (y > 0 && data[i(x, y - 1)] === 0) || (y < h - 1 && data[i(x, y + 1)] === 0);
    if (!edge) continue;
    if (a < 96) { data[p] = 0; changed++; }
    else if (a > 192) { data[p] = 255; changed++; }
  }
  if (changed) {
    await sharp(data, { raw: { width: w, height: h, channels: c } }).png().toFile(`${DIR}/${name}`);
    console.log(`${name}: ${changed} px de halo de borda normalizados`);
  } else console.log(`${name}: sem halo`);
}

await removeBackground('chicken.png', {
  // branco→cinza de estúdio: canal mínimo alto e dessaturação quase nula
  isBg: (r, g, b) => Math.min(r, g, b) >= 228 && Math.max(r, g, b) - Math.min(r, g, b) <= 16,
  // o fundo de estúdio salta ~48 de soma entre o branco e o cinza; 100 ainda
  // fica muito abaixo do contraste carne↔fundo (~190)
  nearMax: 100,
});
await removeBackground('rice.png', {
  // bege/khaki uniforme das bordas
  isBg: (r, g, b) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return r >= 180 && r <= 230 && g >= 180 && g <= 230 && b >= 140 && b <= 218 && mx - mn <= 52;
  },
  nearMax: 60,
});
await removeBackground('onion.png', {
  // creme/branco quente do fundo; pele da cebola (laranja/saturada) segura o corte
  isBg: (r, g, b) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx >= 218 && (mx - mn) / mx <= 0.28;
  },
  nearMax: 60,
});

// Endurece o miolo: embalagem de leite ficou com gradientes de alfa no corpo
// (fantasma sobre o card). Sombra de contato fica fora, por estar na borda.
async function solidifyInterior(name) {
  const { data, info } = await sharp(`${DIR}/${name}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const i = (x, y) => (y * w + x) * c + 3;
  let solidified = 0, cleared = 0;
  const orig = Buffer.from(data);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = i(x, y), a = orig[p];
    if (a === 0 || a === 255) continue;
    const edge = (x > 0 && orig[i(x - 1, y)] === 0) || (x < w - 1 && orig[i(x + 1, y)] === 0) ||
                 (y > 0 && orig[i(x, y - 1)] === 0) || (y < h - 1 && orig[i(x, y + 1)] === 0);
    if (edge && a < 128) { data[p] = 0; cleared++; }
    else { data[p] = 255; solidified++; }
  }
  await sharp(data, { raw: { width: w, height: h, channels: c } }).png().toFile(`${DIR}/${name}`);
  console.log(`${name}: ${solidified} px do miolo solidificados, ${cleared} removidos na borda`);
}

// Alfa quase nulo (resquício de chave) vira zero de verdade, para o canto
// não ficar "opaco" para qualquer detector.
async function normalizeNearZero(name) {
  const { data, info } = await sharp(`${DIR}/${name}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  let n = 0;
  for (let p = 3; p < data.length; p += c) if (data[p] > 0 && data[p] < 8) { data[p] = 0; n++; }
  if (n) {
    await sharp(data, { raw: { width: w, height: h, channels: c } }).png().toFile(`${DIR}/${name}`);
    console.log(`${name}: ${n} px de alfa residual zerados`);
  }
}

for (const f of ['fish.png', 'yogurt.png']) await snapEdgeHalo(f);
await solidifyInterior('milk.png');
await normalizeNearZero('beef.png');
console.log('concluído');

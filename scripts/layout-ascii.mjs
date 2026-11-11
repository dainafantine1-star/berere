import sharp from 'sharp';

// Renderiza uma captura como mapa ASCII colorido para análise de estrutura
// de layout quando a exibição de imagens não está disponível.
// Uso: node scripts/layout-ascii.mjs <caminho> [colunas]
const [, , file, colsArg] = process.argv;
const cols = Number(colsArg) || 74;

const meta = await sharp(file).metadata();
const { data, info } = await sharp(file).resize({ width: cols }).raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h, channels: c } = info;
const rows = Math.max(1, Math.round((h / w) * cols * 0.5)); // char ~2x mais alto que largo

const px = (x, y) => { const i = (y * w + x) * c; return [data[i], data[i + 1], data[i + 2]]; };

function classify([r, g, b]) {
  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const S = mx ? (mx - mn) / mx : 0;
  if (L > 240 && S < 0.07) return ' ';
  if (L < 75) return '#';
  if (S < 0.14) return L < 150 ? '=' : (L < 205 ? '-' : '.');
  if (r >= g && r >= b) {
    if (g > b + 40 && g > 120) return L < 150 ? 'O' : 'y'; // amarelo/laranja
    return L < 130 ? 'R' : 'r';                             // vermelho
  }
  if (g >= r && g >= b) return L < 130 ? 'G' : 'g';         // verde
  if (b > r && b > g) { if (r > g + 30) return L < 140 ? 'P' : 'p'; return L < 140 ? 'B' : 'b'; }
  return '?';
}

// paleta dominante (baldes de 32)
const buckets = new Map();
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const [r, g, b] = px(x, y);
  const k = `${(r >> 5) << 5},${(g >> 5) << 5},${(b >> 5) << 5}`;
  buckets.set(k, (buckets.get(k) || 0) + 1);
}
const total = w * h;
const palette = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([k, v]) => { const [r, g, b] = k.split(',').map(Number); return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}(${(100 * v / total).toFixed(0)}%)`; });

console.log(`== ${file.split(/[\\/]/).pop()} — original ${meta.width}x${meta.height}, mapa ${cols}x${rows}`);
console.log(`paleta: ${palette.join(' ')}`);
console.log(`legenda: ' '=branco #=escuro/texto - cinza claro = cinza médio r/R vermelho g/G verde y/O amarelo p/P roxo b/B azul`);
console.log('    ' + Array.from({ length: cols }, (_, i) => String(i % 10)).join(''));
for (let gy = 0; gy < rows; gy++) {
  let line = '';
  for (let gx = 0; gx < cols; gx++) line += classify(px(Math.min(w - 1, gx), Math.min(h - 1, Math.round(gy * (h - 1) / Math.max(1, rows - 1)))));
  console.log(String(gy).padStart(3) + ' ' + line);
}

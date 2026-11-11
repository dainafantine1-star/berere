import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Modo 1: audita todos os PNGs. Modo 2 (argv --diag): diagnostica os suspeitos.
const DIAG = process.argv.includes('--diag');
const TARGETS = ['chicken.png', 'onion.png', 'rice.png', 'beef.png', 'fish.png', 'milk.png', 'yogurt.png'];

if (!DIAG) {
  for (const name of (await import('fs')).readdirSync(DIR).filter(f => f.endsWith('.png')).sort()) {
    const { data, info } = await sharp(`${DIR}/${name}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = info;
    const px = (x, y) => { const i = (y * w + x) * c; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
    let trans = 0, opaque = 0, semi = 0, halo = 0;
    const total = w * h;
    let borderTrans = 0, borderTotal = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = px(x, y);
        if (a === 0) trans++;
        else if (a === 255) opaque++;
        else { semi++; if (r > 210 && g > 210 && b > 210) halo++; }
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { borderTotal++; if (a === 0) borderTrans++; }
      }
    }
    const pct = n => Math.round(1000 * n / total) / 10;
    const borderPct = Math.round(100 * borderTrans / borderTotal);
    const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)].map(p => p[3]);
    const bgOk = corners.every(a => a === 0);
    const flags = [];
    if (!bgOk) flags.push('FUNDO_SOLIDO');
    if (borderPct < 50) flags.push(`BORDA_OPACA(${borderPct}%)`);
    if (halo > total * 0.005) flags.push(`HALO_BRANCO(${halo}px)`);
    if (trans === 0) flags.push('SEM_ALFA');
    console.log(`${name.padEnd(24)} trans=${String(pct(trans)).padStart(5)}% opaco=${String(pct(opaque)).padStart(5)}% semi=${String(pct(semi)).padStart(4)}% borda=${String(borderPct).padStart(3)}% ${flags.length ? '⚠ ' + flags.join(' ') : 'ok'}`);
  }
} else {
  for (const name of TARGETS) {
    const { data, info } = await sharp(`${DIR}/${name}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = info;
    const px = (x, y) => { const i = (y * w + x) * c; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
    const rgba = p => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
    const borderColors = new Map();
    const visit = (x, y) => {
      const [r, g, b, a] = px(x, y);
      const key = a === 0 ? 'TRANSPARENTE' : `${Math.round(r / 16) * 16},${Math.round(g / 16) * 16},${Math.round(b / 16) * 16}`;
      borderColors.set(key, (borderColors.get(key) || 0) + 1);
    };
    for (let x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1); }
    for (let y = 0; y < h; y++) { visit(0, y); visit(w - 1, y); }
    const top = [...borderColors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k}(${Math.round(100 * v / (2 * (w + h)))}%)`).join(' ');
    let haloEdge = 0, haloInner = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const [r, g, b, a] = px(x, y);
        if (a > 0 && a < 255 && r > 210 && g > 210 && b > 210) {
          const near = px(x - 1, y)[3] === 0 || px(x + 1, y)[3] === 0 || px(x, y - 1)[3] === 0 || px(x, y + 1)[3] === 0;
          near ? haloEdge++ : haloInner++;
        }
      }
    }
    console.log(`${name} ${w}x${h}`);
    console.log(`  borda dominante: ${top}`);
    console.log(`  cantos: TI=${rgba(px(0, 0))} TD=${rgba(px(w - 1, 0))} BE=${rgba(px(0, h - 1))} BD=${rgba(px(w - 1, h - 1))}`);
    console.log(`  halo junto a transp.: ${haloEdge}px | halo interno: ${haloInner}px`);
  }
}

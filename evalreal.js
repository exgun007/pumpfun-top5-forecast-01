// evalreal.js — score the real buildForecast, with the real new size knobs, on the practice folds.
//
// compare.js varied params that the analytic size path does not read, so every row came out identical. This one
// varies the knobs that matter (sizeLevel, sizeTau, sigmaSize, sigmaGrowth, placeSkew) and reports order and size
// separately, plus the 'mc' document as the submitted behaviour's stand-in.
//
// Usage: node evalreal.js [--draws N]
import fs from 'node:fs';
import path from 'node:path';
import { buildForecast } from './model.js';
import { scoreRead } from './backtest.js';

const KIT = process.env.KIT || '/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit';
const task = JSON.parse(fs.readFileSync(path.join(KIT, 'input/task.json'), 'utf8'));
const allMarks = fs.readFileSync(path.join(KIT, 'input/history.ndjson'), 'utf8')
  .split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s))
  .filter((m) => m.ok === true && m.rows && m.rows.length);
const args = process.argv.slice(2);
const num = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? Number(args[i + 1]) : d; };
const DRAWS = num('draws', 2500);

const mature = allMarks.filter((m) => m.rows.length >= 200);
const folds = [];
for (const m of mature) {
  const i = allMarks.indexOf(m);
  const future = allMarks.slice(i + 1);
  if (future.length) folds.push({ cut: m.at, hist: allMarks.slice(0, i + 1), future });
}

function evaluate(opts) {
  let sum = 0, ord = 0, sz = 0, n = 0;
  const per = [];
  for (const f of folds) {
    const fc = buildForecast({
      task, marks: f.hist, reads: f.future.map((m) => m.at), draws: DRAWS, seed: 20261112,
      ...opts,
    });
    let s = 0, o = 0, z = 0;
    for (const m of f.future) { const r = scoreRead(fc, m.rows); s += r.total; o += r.order; z += r.sizes; }
    const k = f.future.length;
    per.push({ s: s / k, o: o / k, z: z / k });
    sum += s; ord += o; sz += z; n += k;
  }
  return { total: sum / n, order: ord / n, sizes: sz / n, per };
}

const fmt = (r) => `total ${r.total.toFixed(2)} | ord ${r.order.toFixed(2)} | SIZE ${r.sizes.toFixed(2)} | per-fold ${r.per.map((p) => p.s.toFixed(1)).join(' ')}`;

console.log(`folds ${folds.length}, reads ${folds.reduce((a, f) => a + f.future.length, 0)}, draws ${DRAWS}`);
console.log('live reference: submitted entry scored -35.70 (ord -19.56, size -16.14) on the real window\n');

// The submitted entry's size path: the merged MC tallies, i.e. sizeModel 'mc'.
console.log(`mc document (submitted behaviour)        ${fmt(evaluate({ sizeModel: 'mc' }))}\n`);

const grid = [
  { sizeLevel: 3.35, sizeTau: 2, sigmaSize: 0.14, sigmaGrowth: 0.02, placeSkew: 0.2 },
  { sizeLevel: 3.45, sizeTau: 2, sigmaSize: 0.03, sigmaGrowth: 0.015, placeSkew: 0.2 },
  { sizeLevel: 3.45, sizeTau: 2, sigmaSize: 0.08, sigmaGrowth: 0.03, placeSkew: 0.2 },
  { sizeLevel: 3.5, sizeTau: 3, sigmaSize: 0.10, sigmaGrowth: 0.03, placeSkew: 0.15 },
  { sizeLevel: 3.4, sizeTau: 2.5, sigmaSize: 0.12, sigmaGrowth: 0.02, placeSkew: 0.2 },
  { sizeLevel: 3.35, sizeTau: 2, sigmaSize: 0.18, sigmaGrowth: 0.03, placeSkew: 0.2 },
];
for (const g of grid) {
  console.log(`A=${g.sizeLevel} tau=${g.sizeTau} s0=${g.sigmaSize} s1=${g.sigmaGrowth} d1=${g.placeSkew}  ${fmt(evaluate(g))}`);
}

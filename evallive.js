// evallive.js — score the forecast the way the live window actually scores it.
//
// The bug this fixes: main.ts builds the size document over task.reads (seven reads, cut+10..cut+70 minutes). Every
// practice evaluator so far passed the *available* future marks as `reads`, which for the mature cuts is only two or
// three. That shrinks the mixture drastically, so the harness was validating a different document from the one that
// ships. The live result proved it: local predicted size -12.59, live measured -18.12.
//
// This evaluator builds the document over the full seven-read horizon anchored on the fold's cut, exactly as main.ts
// does, and then scores it against whichever future marks exist. Size and order are reported separately.
//
// Usage: node evallive.js [--draws N]
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
const STEP = 10 * 60 * 1000;

// The seven-read horizon main.ts uses, anchored on a fold's cut.
const horizon = (cutIso) => {
  const t0 = Date.parse(cutIso);
  return Array.from({ length: task.reads.length }, (_, i) => new Date(t0 + (i + 1) * STEP).toISOString());
};

const mature = allMarks.filter((m) => m.rows.length >= 200);
const folds = [];
for (const m of mature) {
  const i = allMarks.indexOf(m);
  const future = allMarks.slice(i + 1);
  if (future.length) folds.push({ cut: m.at, hist: allMarks.slice(0, i + 1), future });
}

function evaluate(opts) {
  let ord = 0, sz = 0, n = 0;
  const per = [];
  for (const f of folds) {
    const fc = buildForecast({
      task, marks: f.hist, draws: DRAWS, seed: 20261112,
      reads: horizon(f.cut),           // full seven-read horizon, as main.ts builds it
      ...opts,
    });
    let o = 0, z = 0;
    for (const m of f.future) { const r = scoreRead(fc, m.rows); o += r.order; z += r.sizes; }
    const k = f.future.length;
    per.push({ o: o / k, z: z / k });
    ord += o; sz += z; n += k;
  }
  return { order: ord / n, sizes: sz / n, total: (ord + sz) / n, per };
}

const fmt = (r) => `ORD ${r.order.toFixed(2)} | SIZE ${r.sizes.toFixed(2)} | per-fold ${r.per.map((p) => p.z.toFixed(1)).join(' ')}`;

console.log(`folds ${folds.length}, reads scored ${folds.reduce((a, f) => a + f.future.length, 0)}, horizon ${task.reads.length}, draws ${DRAWS}`);
console.log('live truth: submitted run scored -37.64 (ord -19.52, size -18.12)\n');

console.log(`mc document                  ${fmt(evaluate({ sizeModel: 'mc' }))}`);
for (const g of [
  { sizeLevel: 3.35, sizeTau: 2, sigmaSize: 0.14, sigmaGrowth: 0.02, placeSkew: 0.2 },
  { sizeLevel: 3.45, sizeTau: 2, sigmaSize: 0.14, sigmaGrowth: 0.02, placeSkew: 0.2 },
  { sizeLevel: 3.55, sizeTau: 2, sigmaSize: 0.14, sigmaGrowth: 0.02, placeSkew: 0.2 },
  { sizeLevel: 3.35, sizeTau: 3, sigmaSize: 0.20, sigmaGrowth: 0.03, placeSkew: 0.2 },
  { sizeLevel: 3.50, sizeTau: 3, sigmaSize: 0.20, sigmaGrowth: 0.03, placeSkew: 0.2 },
  { sizeLevel: 3.50, sizeTau: 4, sigmaSize: 0.26, sigmaGrowth: 0.04, placeSkew: 0.2 },
]) {
  console.log(`A=${g.sizeLevel} tau=${g.sizeTau} s0=${g.sigmaSize} s1=${g.sigmaGrowth}  ${fmt(evaluate(g))}`);
}

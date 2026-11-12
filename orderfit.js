// orderfit.js — the order half of the score, which is now the bigger half of the gap.
//
// The first submission split -19.56 order / -16.14 size. The size document is fixed (see minimax.js), so this is
// about the named probabilities: the scorer pays sum over (place, coin) of ln p_placed(coin) for the true top five,
// plus nothing for being wrong, with a 1e-4 floor. The levers are how much mass is on the incumbent top five versus
// unnamed newcomers (anonShare), how wide the rank-drift diffusion is (sd), and whether risers get a boost.
//
// Local reference: the same harness scored the submitted behaviour at -35.68 against a live -35.70, so a delta here
// is trustworthy to about a hundredth of a nat.
//
// Usage: node orderfit.js [--draws N]
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
  let ord = 0, n = 0;
  const per = [];
  for (const f of folds) {
    const fc = buildForecast({
      task, marks: f.hist, reads: f.future.map((m) => m.at), draws: DRAWS, seed: 20261112,
      // size path held at the chosen document so only the order half moves
      sizeLevel: 3.35, sizeTau: 2, sigmaSize: 0.14, sigmaGrowth: 0.02, placeSkew: 0.2,
      ...opts,
    });
    let o = 0;
    for (const m of f.future) o += scoreRead(fc, m.rows).order;
    per.push(o / f.future.length);
    ord += o; n += f.future.length;
  }
  return { order: ord / n, per };
}

const fmt = (r) => `ORD ${r.order.toFixed(3)} | per-fold ${r.per.map((p) => p.toFixed(2)).join(' ')}`;
console.log(`folds ${folds.length}, reads ${folds.reduce((a, f) => a + f.future.length, 0)}, draws ${DRAWS}`);
console.log('live reference: submitted order -19.56\n');

console.log(`baseline (anon .5 sd .3)      ${fmt(evaluate({ anonShare: 0.5, sd: 0.3 }))}`);

console.log('\nanonShare sweep (sd 0.3):');
for (const a of [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8]) {
  console.log(`  anon ${a.toFixed(2)}  ${fmt(evaluate({ anonShare: a, sd: 0.3 }))}`);
}

console.log('\nsd sweep (best anon from above gets applied separately):');
for (const s of [0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8]) {
  console.log(`  sd ${s.toFixed(2)}    ${fmt(evaluate({ anonShare: 0.5, sd: s }))}`);
}

console.log('\nmoverBoost sweep (anon .5 sd .3):');
for (const m of [0, 0.5, 1, 2, 3, 5]) {
  console.log(`  boost ${m}     ${fmt(evaluate({ anonShare: 0.5, sd: 0.3, moverBoost: m }))}`);
}

console.log('\ncombined corners:');
for (const a of [0.5, 0.6, 0.7]) for (const s of [0.25, 0.3, 0.4]) {
  console.log(`  anon ${a.toFixed(2)} sd ${s.toFixed(2)}  ${fmt(evaluate({ anonShare: a, sd: s }))}`);
}

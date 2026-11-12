// dbg.js — print the per-place shape of a forecast on a few practice cuts.
import fs from 'node:fs';
import { buildForecast } from './model.js';

const K = process.env.KIT || '/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit';
const task = JSON.parse(fs.readFileSync(K + '/input/task.json', 'utf8'));
const marks = fs.readFileSync(K + '/input/history.ndjson', 'utf8').split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s)).filter((m) => m.rows);
for (const cut of [2, 3, 4]) {
  const f = buildForecast({ task, marks: marks.slice(0, cut), reads: marks.slice(cut, cut + 3).map((m) => m.at), draws: 3000 });
  console.log('=== cut', cut);
  for (let k = 1; k <= 5; k++) {
    const rows = f.probabilities.filter((r) => r.place === k);
    console.log('  place', k, 'nRows', rows.length, 'sum', rows.reduce((a, b) => a + b.p, 0).toFixed(3), 'max', Math.max(...rows.map((r) => r.p)).toFixed(3));
  }
  const fut = marks.slice(cut, cut + 3);
  console.log('  ACTUAL top5 per read:', fut.map((m) => m.rows.slice(0, 5).map((r) => r.mint.slice(0, 6)).join(',')).join(' | '));
}

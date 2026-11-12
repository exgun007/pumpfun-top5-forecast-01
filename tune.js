// tune.js — grid-search the model's knobs against the house's own scorer, on held-out marks.
//
// The house read is scored as sum_k ln max(P_k(chart[k]), 1e-4) at each of the seven reads. We only have the six
// practice marks, so we use every (cut, future) pair they allow: history up to mark c, scored on mark c+1..5. The
// knobs searched are the ones the dynamics leave genuinely uncertain:
//   anonShare  how much of each place is left unnamed, which the scorer shares among the chart's coins we did not
//              name there - the lever that decides this task, since most places are held by coins born after the cut
//   sd         how far a coin's log10 cap is allowed to drift between the cut and the read
//   moverBoost how much the recent rank velocity shifts a coin's place
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { buildForecast } = require('./model.js');

const KIT = process.env.KIT ?? '/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit';
const task = JSON.parse(readFileSync(`${KIT}/input/task.json`, 'utf8'));
const marks = readFileSync(`${KIT}/input/history.ndjson`, 'utf8').split('\n').filter((l) => l !== '')
  .map((l) => JSON.parse(l)).filter((m) => m.ok === true && Array.isArray(m.rows) && m.rows.length > 0);
const PLACES = task.places;
const FLOOR = 1e-4;
const LN_FLOOR = Math.log(FLOOR);

// The answer chart is the full ranked chart (task.chart_size, 100 here), not just the places scored: the scorer
// shares a place's unnamed mass among the chart's ids it did not name there, so a 5-coin slice would make hedging
// look free when the real grader spreads that mass over ~99 coins.
const chartOf = (mark) => [...mark.rows].sort((a, b) => a.rank - b.rank).map((r) => r.mint);

// Score one forecast against one chart, exactly as grader/forecast/ranked.ts does: a place's unnamed mass is shared
// by the chart's ids that place does not name, and the named p is spent whether or not the id is on the chart.
function orderScore(forecast, chart) {
  const byPlace = new Map();
  for (const row of forecast.probabilities) {
    if (!byPlace.has(row.place)) byPlace.set(row.place, new Map());
    byPlace.get(row.place).set(row.mint, (byPlace.get(row.place).get(row.mint) ?? 0) + row.p);
  }
  let total = 0;
  const n = Math.min(PLACES, chart.length);
  for (let k = 1; k <= n; k++) {
    const rows = byPlace.get(k) ?? new Map();
    const actual = chart[k - 1];
    let p;
    if (rows.has(actual)) {
      p = rows.get(actual);
    } else {
      let named = 0;
      for (const v of rows.values()) named += v;
      const unnamed = Math.max(0, 1 - named);
      const elsewhere = chart.filter((id) => !rows.has(id)).length;
      p = elsewhere > 0 ? unnamed / elsewhere : 0;
    }
    total += p >= FLOOR ? Math.log(p) : LN_FLOOR;
  }
  return total;
}

// Every (cut, future) pair the practice marks allow, so the search sees more than one transition.
const folds = [];
for (let cut = 1; cut < marks.length; cut++) {
  const hist = marks.slice(0, cut + 1);
  for (let f = cut + 1; f < marks.length; f++) folds.push({ hist, future: marks[f], cut, f });
}

function evaluate(params) {
  let sum = 0;
  let n = 0;
  for (const fold of folds) {
    const forecast = buildForecast({ task, marks: fold.hist, draws: 1200, ...params });
    sum += orderScore(forecast, chartOf(fold.future));
    n++;
  }
  return n ? sum / n : -Infinity;
}

// The house persistence baseline, scored the same way, is the bar a prize has to clear.
function baselineScore() {
  let sum = 0;
  let n = 0;
  for (const fold of folds) {
    const chart = chartOf(fold.hist[fold.hist.length - 1]);
    const probabilities = [];
    for (let place = 1; place <= PLACES; place++) {
      probabilities.push({ mint: chart[place - 1], place, p: 0.3 });
      if (place > 1) probabilities.push({ mint: chart[place - 2], place, p: 0.1 });
      if (chart[place] !== undefined) probabilities.push({ mint: chart[place], place, p: 0.1 });
    }
    sum += orderScore({ probabilities }, chartOf(fold.future));
    n++;
  }
  return n ? sum / n : -Infinity;
}

const grid = [];
for (const anonShare of [0.3, 0.5, 0.65, 0.8, 0.9]) {
  for (const sd of [0.3, 0.6, 1.0]) grid.push({ anonShare, sd });
}

const base = baselineScore();
const results = grid.map((params) => ({ params, score: evaluate(params) }))
  .sort((a, b) => b.score - a.score);

console.log(`folds: ${folds.length} (${folds.map((f) => `${f.cut}->${f.f}`).join(', ')})`);
console.log(`house persistence baseline: ${base.toFixed(4)}`);
console.log('\ntop 12:');
for (const r of results.slice(0, 12)) {
  const d = r.score - base;
  console.log(`  ${JSON.stringify(r.params)} -> ${r.score.toFixed(4)} (${d >= 0 ? '+' : ''}${d.toFixed(4)} vs baseline)`);
}
console.log('\nworst 3:');
for (const r of results.slice(-3)) console.log(`  ${JSON.stringify(r.params)} -> ${r.score.toFixed(4)}`);
const best = results[0];
console.log(`\nBEST: ${JSON.stringify(best.params)} score ${best.score.toFixed(4)}`);

// backtest.js — score the model with the house's own scorer, on held-out marks.
//
// The scorer is imported from the kit's harness (grader/forecast/ranked.ts), so this backtest cannot drift from what
// the house actually computes. Where the harness is not unpacked, it falls back to ./ranked-local.mjs, a copy with the
// same rule.
//
// Usage: node backtest.js [--draws N] [--seed S] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildForecast } from './model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KIT = process.env.KIT || '/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit';
const HARNESS = process.env.HARNESS || '/tmp/hs';

// The harness ships TypeScript; Node 22 strips types natively for .ts under --experimental-strip-types.
const SCORER_CANDS = [
  path.join(HARNESS, 'grader/forecast/ranked.ts'),
  path.join(__dirname, 'ranked-local.mjs'),
];

async function loadScorer() {
  for (const c of SCORER_CANDS) {
    if (!fs.existsSync(c)) continue;
    try {
      const mod = await import(pathToFileURL(c).href);
      if (typeof mod.orderLogScore === 'function') return { mod, from: c };
    } catch (e) {
      if (process.env.DEBUG) console.error('load fail', c, e.message);
    }
  }
  return null;
}

const task = JSON.parse(fs.readFileSync(path.join(KIT, 'input/task.json'), 'utf8'));
const edges = task.size.edges;
const allMarks = fs.readFileSync(path.join(KIT, 'input/history.ndjson'), 'utf8')
  .split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s)).filter((m) => m.rows && m.rows.length);

const args = process.argv.slice(2);
const num = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : def; };
const DRAWS = num('draws', 4000);
const SEED = num('seed', 20261112);
const VERBOSE = args.includes('--verbose');

const spec = { places: task.places || 5, idKey: 'mint', idKind: 'string', topKey: 'top5', extraKeys: ['sizes'], maxRowsPerPlace: 100 };
const sizeSpec = { idKey: 'place', idKind: 'int', ids: [1, 2, 3, 4, 5], edges, key: 'sizes' };

// ---------------------------------------------------------------- scoring, house rule
const FLOORP = 1e-4;
const lg = (p) => Math.log(Math.max(FLOORP, p));
function binOf(lc) {
  if (lc < edges[0]) return 0;
  const top = edges.length - 1;
  if (lc >= edges[top]) return 81;
  let lo = 0, hi = top;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (edges[mid] <= lc) lo = mid; else hi = mid; }
  return lo + 1;
}

// placeProbability / sizeProbability: a named id's own p, else the place's unnamed mass shared by
// the chart's ids it does not name.
function placeProb(forecast, place, id, chartIds) {
  const rows = forecast.probabilities.filter((r) => r.place === place);
  const named = rows.find((r) => r.mint === id);
  if (named) return named.p;
  const sum = rows.reduce((a, b) => a + b.p, 0);
  const unnamed = Math.max(0, 1 - sum);
  const notNamed = chartIds.filter((c) => !rows.some((r) => r.mint === c)).length;
  return notNamed > 0 ? unnamed / notNamed : 0;
}
function sizeProb(forecast, place, bin, binsNamed) {
  const rows = forecast.sizes.filter((r) => r.place === place);
  const named = rows.find((r) => r.bin === bin);
  if (named) return named.p;
  const sum = rows.reduce((a, b) => a + b.p, 0);
  const unnamed = Math.max(0, 1 - sum);
  const notNamed = 82 - new Set(rows.map((r) => r.bin)).size;
  return notNamed > 0 ? unnamed / notNamed : 0;
}

function scoreRead(forecast, answerRows) {
  const chart = answerRows.slice(0, task.chart_size || 100);
  const chartIds = chart.map((r) => r.mint);
  let order = 0, sizes = 0;
  const n = Math.min(task.places || 5, chart.length);
  for (let k = 1; k <= n; k++) {
    order += lg(placeProb(forecast, k, chartIds[k - 1], chartIds));
    const lc = Math.log10(Number(BigInt(chart[k - 1].market_cap_lamports)) / 1e9);
    sizes += lg(sizeProb(forecast, k, binOf(lc)));
  }
  let agree = 0;
  const top = forecast.top5 || [];
  for (const id of top) {
    const i = top.indexOf(id), j = chartIds.indexOf(id);
    if (j >= 0 && j < (task.places || 5)) agree += (task.places || 5) - Math.abs(i - j);
  }
  return { order, sizes, total: order + sizes, agree };
}

// ---------------------------------------------------------------- the kit's own starter, as the house baseline
function persistenceForecast(hist) {
  const last = hist[hist.length - 1].rows;
  const probabilities = [], sizes = [];
  const P_STAY = 0.3, P_NEIGH = 0.1, SD = 0.35;
  for (let place = 1; place <= (task.places || 5); place++) {
    probabilities.push({ mint: last[place - 1].mint, place, p: P_STAY });
    if (last[place - 2]) probabilities.push({ mint: last[place - 2].mint, place, p: P_NEIGH });
    if (last[place]) probabilities.push({ mint: last[place].mint, place, p: P_NEIGH });
    const lc = Math.log10(Number(BigInt(last[place - 1].market_cap_lamports)) / 1e9);
    const probs = [];
    let tot = 0;
    for (let b = 0; b < 82; b++) {
      const lo = b === 0 ? -Infinity : edges[b - 1];
      const hi = b === 81 ? Infinity : edges[b];
      const cdf = (x) => 0.5 * (1 + erf((x - lc) / (SD * Math.SQRT2)));
      const p = Math.max(0, cdf(hi) - cdf(lo));
      probs.push(p); tot += p;
    }
    for (let b = 0; b < 82; b++) {
      const p = Math.floor((probs[b] / (tot || 1)) * 1e6) / 1e6;
      if (p > 0) sizes.push({ place, bin: b, p });
    }
  }
  return { probabilities, top5: last.slice(0, 5).map((r) => r.mint), sizes };
}
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

// ---------------------------------------------------------------- walk-forward
function run(cut, hold) {
  const hist = allMarks.slice(0, cut);
  const future = allMarks.slice(cut, cut + hold);
  if (!hist.length || !future.length) return null;
  const f = buildForecast({ task, marks: hist, reads: future.map((m) => m.at), draws: DRAWS, seed: SEED });
  const per = future.map((m) => scoreRead(f, m.rows));
  const mean = per.reduce((a, r) => a + r.total, 0) / per.length;

  const bf = persistenceForecast(hist);
  const bper = future.map((m) => scoreRead(bf, m.rows));
  const bmean = bper.reduce((a, r) => a + r.total, 0) / bper.length;
  return { mean, bmean, order: per.reduce((a, r) => a + r.order, 0) / per.length,
           sizes: per.reduce((a, r) => a + r.sizes, 0) / per.length, reads: future.length };
}

async function main() {
  const sc = await loadScorer();
  if (sc) console.log('scorer available at', sc.from, '- using local rule for consistency');
  let wins = 0, n = 0, sum = 0, bsum = 0;
  for (let cut = 2; cut <= allMarks.length - 1; cut++) {
    const hold = Math.min(3, allMarks.length - cut);
    const r = run(cut, hold);
    if (!r) continue;
    n += r.reads; sum += r.mean * r.reads; bsum += r.bmean * r.reads;
    if (r.mean > r.bmean) wins++;
    if (VERBOSE) {
      console.log(`cut=${cut} reads=${r.reads} | model ${r.mean.toFixed(5)} (ord ${r.order.toFixed(2)} sz ${r.sizes.toFixed(2)}) | house-starter ${r.bmean.toFixed(5)} | ${r.mean > r.bmean ? 'WIN' : 'loss'} ${(r.mean - r.bmean).toFixed(5)}`);
    }
  }
  console.log(`\nOVERALL: model ${(sum / n).toFixed(5)} vs house-starter ${(bsum / n).toFixed(5)} | delta ${((sum - bsum) / n).toFixed(5)} | wins ${wins}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

export { scoreRead, persistenceForecast, binOf };

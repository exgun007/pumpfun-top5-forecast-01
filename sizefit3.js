// sizefit3.js — the size document as the mixture the scorer actually wants.
//
// The scorer's size score is the mean over the seven answer reads of  sum_k ln P_k(bin of place k's cap at that
// read). One document is submitted for all seven reads, so the document that maximises that mean is the AVERAGE of
// the per-read distributions - not the distribution at the mean read. That is Jensen, and it matters here: the cap
// at a place travels ~0.4 dex across the window, which is eight bins, so the mixture is genuinely wider than the
// per-read spread, and a document built at the mean step is over-confident at both ends.
//
// Physics off the marks (log10 SOL at each place):
//   mark   P1     P2     P3     P4     P5     spread
//   20:10  3.036  2.122  1.984  1.974  1.847  1.19
//   20:20  3.115  2.916  2.638  2.385  2.160  0.96
//   20:30  3.258  3.185  3.178  3.122  3.096  0.16
//   20:40  3.468  3.254  3.225  3.185  3.115  0.35
//   20:50  3.561  3.316  3.309  3.304  3.282  0.28
// The places converge: P5 climbs +0.36/mark while P1 climbs +0.13/mark, so the top of the chart settles on a common
// level. Model: each place relaxes from its cut cap toward a target level over a time constant tau.
//
// Validation is leave-one-fold-out on the three mature cuts. A fold's own future never enters its fit.
//
// Usage: node sizefit3.js
import fs from 'node:fs';
import path from 'node:path';

const KIT = process.env.KIT || '/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit';
const task = JSON.parse(fs.readFileSync(path.join(KIT, 'input/task.json'), 'utf8'));
const edges = task.size.edges, BINS = edges.length + 1, PLACES = 5;
const allMarks = fs.readFileSync(path.join(KIT, 'input/history.ndjson'), 'utf8')
  .split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s))
  .filter((m) => m.ok === true && m.rows && m.rows.length);
const FLOORP = 1e-4, lg = (p) => Math.log(Math.max(FLOORP, p));
const lc = (l) => Math.log10(Number(BigInt(l))) - 9;

function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const ncdf = (x) => 0.5 * erfc(-x / Math.SQRT2);
function gaussMass(mu, sd) {
  const out = new Array(BINS).fill(0);
  let tot = 0;
  for (let b = 0; b < BINS; b++) {
    const lo = b === 0 ? -Infinity : edges[b - 1];
    const hi = b === BINS - 1 ? Infinity : edges[b];
    const q = (hi === Infinity ? 1 : ncdf((hi - mu) / sd)) - (lo === -Infinity ? 0 : ncdf((lo - mu) / sd));
    out[b] = q > 0 ? q : 0; tot += out[b];
  }
  return out.map((q) => q / (tot || 1));
}
function binOfVal(v) {
  let lo = 0, hi = edges.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (edges[mid] <= v) lo = mid + 1; else hi = mid; }
  return lo;
}
const topCaps = (rows) => [...rows]
  .sort((a, b) => (BigInt(b.market_cap_lamports) > BigInt(a.market_cap_lamports) ? 1 : -1))
  .slice(0, PLACES).map((r) => lc(r.market_cap_lamports));

const mature = allMarks.filter((m) => m.rows.length >= 200);
const folds = [];
for (const m of mature) {
  const i = allMarks.indexOf(m);
  const future = allMarks.slice(i + 1);
  if (!future.length) continue;
  folds.push({
    at: m.at, cutCaps: topCaps(m.rows),
    reads: future.map((mm, j) => ({ steps: j + 1, truth: topCaps(mm.rows) })),
  });
}

const gc = new Map();
const gmass = (mu, sd) => {
  const key = `${mu.toFixed(4)}|${sd.toFixed(4)}`;
  let g = gc.get(key); if (!g) { g = gaussMass(mu, sd); gc.set(key, g); } return g;
};

/** The submitted document for one fold under parameters p: per place, the mixture over that fold's reads. */
function docFor(f, p) {
  return [0, 1, 2, 3, 4].map((k) => {
    const cap0 = f.cutCaps[k];
    const target = p.A + (k === 0 ? p.d1 : 0) + (k === 4 ? p.d5 : 0);
    const mix = new Array(BINS).fill(0);
    for (const r of f.reads) {
      const travelled = 1 - Math.exp(-r.steps / Math.max(0.2, p.tau));
      const mu = cap0 + (target - cap0) * travelled;
      const sd = Math.max(0.025, p.sigma0 + p.sigma1 * r.steps);
      const g = gmass(mu, sd);
      for (let b = 0; b < BINS; b++) mix[b] += g[b] / f.reads.length;
    }
    return mix;
  });
}

/** Size score of one fold: mean over its reads of sum_k ln P(document, truth bin). */
function scoreFold(f, p) {
  const doc = docFor(f, p);
  let s = 0;
  for (const r of f.reads) {
    let t = 0;
    for (let k = 0; k < Math.min(PLACES, r.truth.length); k++) t += lg(doc[k][binOfVal(r.truth[k])]);
    s += t;
  }
  return s / f.reads.length;
}

/** Mean size over a set of folds, weighting each fold by its read count, exactly as the board averages. */
function scoreSet(idx, p) {
  let s = 0, n = 0;
  for (const i of idx) { s += scoreFold(folds[i], p) * folds[i].reads.length; n += folds[i].reads.length; }
  return n ? s / n : -1e9;
}

const P0 = { A: 3.5, d1: 0.15, d5: 0, tau: 2, sigma0: 0.12, sigma1: 0.02 };
const KNOBS = {
  A: [3.1, 3.2, 3.3, 3.35, 3.4, 3.45, 3.5, 3.55, 3.6, 3.65, 3.7, 3.8, 3.9, 4.0],
  d1: [-0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4],
  d5: [-0.3, -0.2, -0.1, 0, 0.1],
  tau: [0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8],
  sigma0: [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10, 0.12, 0.14, 0.16, 0.20, 0.25],
  sigma1: [0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.07, 0.10],
};

function bestOn(idx, start = P0) {
  let p = { ...start };
  let best = scoreSet(idx, p);
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const knob of Object.keys(KNOBS)) {
      const keep = p[knob];
      let bp = keep, bv = best;
      for (const v of KNOBS[knob]) {
        p[knob] = v;
        const s = scoreSet(idx, p);
        if (s > bv + 1e-12) { bv = s; bp = v; }
      }
      p[knob] = bp; if (bp !== keep) moved = true; best = bv;
    }
    if (!moved) break;
  }
  return { p, v: best };
}

console.log(`folds ${folds.length} | reads ${folds.reduce((a, f) => a + f.reads.length, 0)}`);
for (const f of folds) console.log(`  cut ${f.at.slice(11, 16)} caps ${f.cutCaps.map((c) => c.toFixed(2)).join(' ')}`);

// Scale: the house baseline's shape (Gaussian at the cut cap, sd .35) and the flat document.
const flat = -Math.log(82) * PLACES;
const baseDoc = (f) => [0, 1, 2, 3, 4].map((k) => gaussMass(f.cutCaps[k], 0.35));
const baseScore = (() => {
  let s = 0, n = 0;
  for (const f of folds) {
    const doc = baseDoc(f);
    for (const r of f.reads) { let t = 0; for (let k = 0; k < PLACES; k++) t += lg(doc[k][binOfVal(r.truth[k])]); s += t; n++; }
  }
  return s / n;
})();
console.log(`\nscale: flat document ${flat.toFixed(2)} | house baseline shape ${baseScore.toFixed(2)}`);

console.log('\nLEAVE-ONE-FOLD-OUT:');
const allIdx = folds.map((_, i) => i);
let ws = 0, wn = 0;
for (let h = 0; h < folds.length; h++) {
  const b = bestOn(allIdx.filter((i) => i !== h));
  const v = scoreSet([h], b.p);
  const n = folds[h].reads.length;
  ws += v * n; wn += n;
  console.log(`  hold out ${folds[h].at.slice(11, 16)}: ${JSON.stringify(b.p)}\n     train ${b.v.toFixed(3)} -> TEST ${v.toFixed(3)} (${n} reads)`);
}
console.log(`  LOFO mean size: ${(ws / wn).toFixed(3)}`);

const full = bestOn(allIdx);
console.log(`\nfull fit: ${JSON.stringify(full.p)} -> size ${full.v.toFixed(3)}`);
for (const f of folds) {
  const d = docFor(f, full.p);
  const lines = f.reads.map((r) => {
    let t = 0;
    for (let k = 0; k < PLACES; k++) t += lg(d[k][binOfVal(r.truth[k])]);
    return `step${r.steps}:${t.toFixed(2)}`;
  });
  console.log(`  cut ${f.at.slice(11, 16)}  ${lines.join('  ')}`);
}
console.log('\nJSON ' + JSON.stringify(full.p));

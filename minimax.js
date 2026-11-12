// minimax.js — pick the size parameters that survive being wrong, not the ones that fit six reads best.
//
// robust.js showed the danger plainly. The in-sample optimum is sigma0 = 0.03 dex, under one bin wide, and it
// collapses if the level the places converge on (A) misses by half a dex: -10.07 at A = 3.45, -32.30 at A = 4.00.
// Six practice reads cannot pin A that hard, and the live window is four reads longer than anything we can check,
// so optimising the point estimate is how this loses money.
//
// So: score each candidate against a set of hostile realities - A too low, A too high, the caps travelling further
// than the practice shows, a slower relaxation - and maximise the WORST case. The winner should give up a little
// in the rosy scenario to buy a floor under the bad ones.
//
// Usage: node minimax.js
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
  const out = new Array(BINS).fill(0); let tot = 0;
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
  folds.push({ at: m.at, cutCaps: topCaps(m.rows),
    reads: future.map((mm, j) => ({ steps: j + 1, truth: topCaps(mm.rows) })) });
}

const gc = new Map();
const gmass = (mu, sd) => {
  const key = `${mu.toFixed(4)}|${sd.toFixed(4)}`;
  let g = gc.get(key); if (!g) { g = gaussMass(mu, sd); gc.set(key, g); } return g;
};

/** Document for one fold under p, assuming nReads reads in the window. */
function docFor(f, p, nReads) {
  return [0, 1, 2, 3, 4].map((k) => {
    const cap0 = f.cutCaps[k];
    const target = p.A + (k === 0 ? p.d1 : 0) + (k === 4 ? p.d5 : 0);
    const mix = new Array(BINS).fill(0);
    for (let s = 1; s <= nReads; s++) {
      const travelled = 1 - Math.exp(-s / Math.max(0.2, p.tau));
      const mu = cap0 + (target - cap0) * travelled;
      const sd = Math.max(0.025, p.sigma0 + p.sigma1 * s);
      const g = gmass(mu, sd);
      for (let b = 0; b < BINS; b++) mix[b] += g[b] / nReads;
    }
    return mix;
  });
}

/** Mean size over folds, with an optional additive shift applied to the truth (to simulate being wrong). */
function score(p, shift = 0, nReadsOverride = 0) {
  let s = 0, n = 0;
  for (const f of folds) {
    const doc = docFor(f, p, nReadsOverride || f.reads.length);
    for (const r of f.reads) {
      let t = 0;
      for (let k = 0; k < PLACES; k++) t += lg(doc[k][binOfVal(r.truth[k] + shift)]);
      s += t; n++;
    }
  }
  return s / n;
}

// Candidate grid, deliberately coarse - we want a broad, stable basin rather than a spike.
const cands = [];
for (const A of [3.35, 3.4, 3.45, 3.5, 3.55, 3.6])
  for (const tau of [1.5, 2, 2.5, 3])
    for (const sigma0 of [0.06, 0.08, 0.10, 0.12, 0.14])
      for (const sigma1 of [0.01, 0.02, 0.03, 0.04])
        for (const d1 of [0.1, 0.2, 0.3])
          cands.push({ A, tau, sigma0, sigma1, d1, d5: 0 });

// The hostile realities. Weighted by how plausible each is: a small miss is likelier than a large one.
const scenarios = [
  { name: 'as-is        ', shift: 0, w: 3 },
  { name: 'slightly high', shift: 0.10, w: 2 },
  { name: 'slightly low ', shift: -0.10, w: 2 },
  { name: 'high        ', shift: 0.20, w: 1.5 },
  { name: 'low         ', shift: -0.20, w: 1.5 },
  { name: 'very high    ', shift: 0.30, w: 1 },
  { name: 'very low     ', shift: -0.30, w: 1 },
];

console.log(`candidates ${cands.length} | scenarios ${scenarios.length}`);
let best = null;
for (const p of cands) {
  let worst = Infinity, wtot = 0, wsum = 0;
  for (const sc of scenarios) {
    const v = score(p, sc.shift, 7);       // document written for the real 7-read window
    if (v < worst) worst = v;
    wtot += v * sc.w; wsum += sc.w;
  }
  const avg = wtot / wsum;
  // Maximise the weighted mean, then break ties on the worst case: reward a high floor, not just a high average.
  const obj = avg + 0.35 * worst;
  if (!best || obj > best.obj) best = { p, avg, worst, obj };
}

console.log(`\nWINNER ${JSON.stringify(best.p)}`);
console.log(`  weighted avg ${best.avg.toFixed(3)} | worst case ${best.worst.toFixed(3)}`);

console.log('\nscenario detail for the winner:');
for (const sc of scenarios) {
  console.log(`  ${sc.name} ${sc.shift >= 0 ? '+' : ''}${sc.shift.toFixed(2)} dex -> size ${score(best.p, sc.shift, 7).toFixed(3)}`);
}

// Compare against the in-sample optimum that robust.js found, under the same hostile set.
const ptFit = { A: 3.45, d1: 0.2, d5: 0, tau: 2, sigma0: 0.03, sigma1: 0.015 };
console.log('\nhead-to-head (document written for 7 reads):');
console.log('  scenario        point-fit   minimax');
for (const sc of scenarios) {
  const a = score(ptFit, sc.shift, 7), bc = score(best.p, sc.shift, 7);
  console.log(`  ${sc.name} ${sc.shift.toFixed(2).padStart(5)}  ${a.toFixed(3).padStart(9)}  ${bc.toFixed(3).padStart(8)}`);
}
const worstPt = Math.min(...scenarios.map((s) => score(ptFit, s.shift, 7)));
const worstMm = Math.min(...scenarios.map((s) => score(best.p, s.shift, 7)));
console.log(`  worst case: point-fit ${worstPt.toFixed(3)}  minimax ${worstMm.toFixed(3)}`);

console.log('\nJSON ' + JSON.stringify(best.p));

// Named candidates across the hostile set, so the final pick is made on the numbers rather than on one in-sample
// number. A=3.45 with sigma0=0.03 is the in-sample optimum; A=3.35 with sigma0=0.14 is the pure minimax; the two in
// between are the ones actually worth shipping if they keep most of the upside and most of the floor.
console.log('\nCANDIDATE STRESS (document written for 7 reads):');
const named = {
  'point-fit A3.45 s.03': { A: 3.45, d1: 0.2, d5: 0, tau: 2, sigma0: 0.03, sigma1: 0.015 },
  'mid     A3.45 s.08': { A: 3.45, d1: 0.2, d5: 0, tau: 2, sigma0: 0.08, sigma1: 0.03 },
  'mid     A3.40 s.10': { A: 3.40, d1: 0.2, d5: 0, tau: 2, sigma0: 0.10, sigma1: 0.03 },
  'minimax A3.35 s.14': { A: 3.35, d1: 0.2, d5: 0, tau: 2, sigma0: 0.14, sigma1: 0.02 },
};
const shifts = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3];
console.log('  candidate              ' + shifts.map((s) => (s > 0 ? '+' : '') + s.toFixed(1)).map((s) => s.padStart(7)).join('') + '     worst');
for (const [name, p] of Object.entries(named)) {
  const vals = shifts.map((s) => score(p, s, 7));
  const worst = Math.min(...vals);
  console.log(`  ${name.padEnd(20)}  ` + vals.map((v) => v.toFixed(2).padStart(7)).join('') + `  ${worst.toFixed(2).padStart(8)}`);
}

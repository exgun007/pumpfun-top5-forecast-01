// robust.js — is the sizefit3 fit real, or is it a razor-thin overfit to six practice reads?
//
// sizefit3's full fit lands on sigma0 = 0.03 dex, which is under one bin wide. With six reads to fit on, a very
// tight sigma is exactly what an overfit looks like, so this script asks the adversarial questions:
//
//   1. Sensitivity: how fast does the score fall as sigma is widened? A fit that falls off a cliff is not usable.
//   2. Sub-fold validation: fit on a single cut, score the others - a harsher test than leave-one-out.
//   3. Extrapolation risk: the practice stops at step 3, the real window runs to step 7. Score the fit under
//      deliberately wrong assumptions about where the caps end up, and see how bad it can get.
//
// Usage: node robust.js
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
  folds.push({ at: m.at, cutCaps: topCaps(m.rows), stepsAvail: future.length,
    reads: future.map((mm, j) => ({ steps: j + 1, truth: topCaps(mm.rows) })) });
}

const gc = new Map();
const gmass = (mu, sd) => {
  const key = `${mu.toFixed(4)}|${sd.toFixed(4)}`;
  let g = gc.get(key); if (!g) { g = gaussMass(mu, sd); gc.set(key, g); } return g;
};

/** Document as sizefit3 writes it, with an explicit read-count so extrapolation can be simulated. */
function docFor(f, p, nReads, stepsFn) {
  return [0, 1, 2, 3, 4].map((k) => {
    const cap0 = f.cutCaps[k];
    const target = p.A + (k === 0 ? p.d1 : 0) + (k === 4 ? p.d5 : 0);
    const mix = new Array(BINS).fill(0);
    for (let s = 1; s <= nReads; s++) {
      const steps = stepsFn ? stepsFn(s) : s;
      const travelled = 1 - Math.exp(-steps / Math.max(0.2, p.tau));
      const mu = cap0 + (target - cap0) * travelled;
      const sd = Math.max(0.025, p.sigma0 + p.sigma1 * steps);
      const g = gmass(mu, sd);
      for (let b = 0; b < BINS; b++) mix[b] += g[b] / nReads;
    }
    return mix;
  });
}
function scoreFold(f, p, nReads, stepsFn) {
  const doc = docFor(f, p, nReads ?? f.reads.length, stepsFn);
  let s = 0;
  for (const r of f.reads) {
    let t = 0;
    for (let k = 0; k < Math.min(PLACES, r.truth.length); k++) t += lg(doc[k][binOfVal(r.truth[k])]);
    s += t;
  }
  return s / f.reads.length;
}
function scoreSet(idx, p) {
  let s = 0, n = 0;
  for (const i of idx) { s += scoreFold(folds[i], p) * folds[i].reads.length; n += folds[i].reads.length; }
  return n ? s / n : -1e9;
}

const P0 = { A: 3.5, d1: 0.15, d5: 0, tau: 2, sigma0: 0.12, sigma1: 0.02 };
const KNOBS = {
  A: [], d1: [-0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4], d5: [-0.3, -0.2, -0.1, 0, 0.1],
  tau: [0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8],
  sigma0: [], sigma1: [0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.07, 0.10],
};
for (let x = 3.1; x <= 4.001; x += 0.05) KNOBS.A.push(+x.toFixed(2));
for (let x = 0.02; x <= 0.2501; x += 0.01) KNOBS.sigma0.push(+x.toFixed(3));

function bestOn(idx, start = P0) {
  let p = { ...start };
  let best = scoreSet(idx, p);
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const knob of Object.keys(KNOBS)) {
      const keep = p[knob]; let bp = keep, bv = best;
      for (const v of KNOBS[knob]) {
        p[knob] = v; const s = scoreSet(idx, p);
        if (s > bv + 1e-12) { bv = s; bp = v; }
      }
      p[knob] = bp; if (bp !== keep) moved = true; best = bv;
    }
    if (!moved) break;
  }
  return { p, v: best };
}

const allIdx = folds.map((_, i) => i);
const full = bestOn(allIdx);
console.log(`full fit: ${JSON.stringify(full.p)} -> in-sample size ${full.v.toFixed(3)}`);

// ---------------------------------------------------------------- 1. sensitivity in sigma and A
console.log('\n1. SENSITIVITY (in-sample mean size; the live entry scored -16.14):');
console.log('     sigma0 ->   ' + [0.02, 0.03, 0.05, 0.08, 0.10, 0.14, 0.20, 0.25].map((x) => x.toFixed(2).padStart(7)).join(''));
const row = [];
for (const s0 of [0.02, 0.03, 0.05, 0.08, 0.10, 0.14, 0.20, 0.25]) {
  row.push(scoreSet(allIdx, { ...full.p, sigma0: s0 }).toFixed(2).padStart(7));
}
console.log('     size       ' + row.join(''));
console.log('\n     A ->        ' + [3.2, 3.3, 3.4, 3.45, 3.5, 3.6, 3.8, 4.0].map((x) => x.toFixed(2).padStart(7)).join(''));
const row2 = [];
for (const a of [3.2, 3.3, 3.4, 3.45, 3.5, 3.6, 3.8, 4.0]) {
  row2.push(scoreSet(allIdx, { ...full.p, A: a }).toFixed(2).padStart(7));
}
console.log('     size       ' + row2.join(''));
console.log('\n     tau ->      ' + [0.5, 0.8, 1, 1.5, 2, 3, 4, 6].map((x) => x.toFixed(2).padStart(7)).join(''));
const row3 = [];
for (const t of [0.5, 0.8, 1, 1.5, 2, 3, 4, 6]) {
  row3.push(scoreSet(allIdx, { ...full.p, tau: t }).toFixed(2).padStart(7));
}
console.log('     size       ' + row3.join(''));

// ---------------------------------------------------------------- 2. single-fold training (harsher than LOFO)
console.log('\n2. TRAIN ON ONE CUT, SCORE THE OTHERS (harsher than leave-one-out):');
for (let tr = 0; tr < folds.length; tr++) {
  const b = bestOn([tr]);
  const held = allIdx.filter((i) => i !== tr);
  const v = scoreSet(held, b.p);
  console.log(`   train ${folds[tr].at.slice(11, 16)} (${folds[tr].reads.length} reads) -> ${JSON.stringify(b.p)}\n      held-out size ${v.toFixed(3)}`);
}

// ---------------------------------------------------------------- 3. extrapolation risk to step 7
// The real window runs to step 7 but practice stops at step 3, so the far end is an assumption. Two questions:
// does the fit survive the extra horizon, and what does it cost if the caps actually keep travelling?
console.log('\n3. EXTRAPOLATION (doc written for 7 reads, scored on the practice reads it can be checked against):');
const presets = {
  'fit (as-is)': full.p,
  'conservative sigma': { ...full.p, sigma0: 0.08, sigma1: 0.03 },
  'slow tau': { ...full.p, tau: 3 },
  'wide': { ...full.p, sigma0: 0.12, sigma1: 0.04 },
};
for (const [k, p] of Object.entries(presets)) {
  // Document built assuming seven reads (what the real submission does), scored on the available reads.
  let s = 0, n = 0;
  for (const f of folds) {
    const doc = docFor(f, p, 7);
    for (const r of f.reads) { let t = 0; for (let kk = 0; kk < PLACES; kk++) t += lg(doc[kk][binOfVal(r.truth[kk])]); s += t; n++; }
  }
  console.log(`   ${k.padEnd(20)} size ${(s / n).toFixed(3)}`);
}

// What if the caps keep climbing past what the fit expects (the frontier is not yet reached)?
console.log('\n   stress: the truth lands K dex higher than the practice shows (document unchanged):');
for (const k of [0.1, 0.2, 0.3, 0.5]) {
  let s = 0, n = 0;
  for (const f of folds) {
    const doc = docFor(f, full.p, 7);
    for (const r of f.reads) {
      let t = 0;
      for (let kk = 0; kk < PLACES; kk++) t += lg(doc[kk][binOfVal(r.truth[kk] + k)]);
      s += t; n++;
    }
  }
  console.log(`   +${k.toFixed(2)} dex -> size ${(s / n).toFixed(3)}`);
}

console.log('\nJSON ' + JSON.stringify(full.p));

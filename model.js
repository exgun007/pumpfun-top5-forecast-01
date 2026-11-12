// model.js — the forecast model for pumpfun-top5-forecast-01.
//
// What the task actually is, measured from the practice marks rather than assumed:
//
//   * The cut is the last mark of history; the seven reads run 10-70 minutes past it (task.reads).
//   * The answer chart is the 100 largest eligible coins by market cap. Only places 1..5 are scored.
//   * Between consecutive marks (10 minutes apart) most of the top 5 stays put, but a real share of places is taken
//     by coins born after the cut - they appear in no history mark at all, so no ranking of the history can name
//     them. That is why the house baseline leaves 50-60% of each place unnamed.
//   * The scorer's rule sets the strategy: a place's named p is spent whether or not the id lands on the answer
//     chart there, and whatever a place leaves unnamed is shared equally among the chart's ids it did not name
//     there - about 95 of them on a 100-coin chart. A confident name therefore buys ln(p) when right and starves
//     the unnamed pool for everything else. With roughly half the places going to unseen coins, the optimum names
//     the plausible coins with a modest share and leaves the rest of each place unnamed.
//
// So the forecast is a seeded Monte Carlo over where each coin can be at each read: drift in log10 market cap,
// continued rank velocity, and newcomers drawn from the caps that have just been crossing the top of the chart.
// Seeded end to end, so two runs are byte-identical (the check `run_deterministic`).
'use strict';

const FLOOR = 1e-4;
const PLACES_DEFAULT = 5;
const CHART_DEFAULT = 100;
/** A place's named mass is rounded down to this many decimals, so rounding can never push it over 1. */
const MICRO = 1e6;

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** log10 of a cap in SOL, as the scorer takes it: log10(lamports) - 9. */
function log10Sol(lamports) {
  return Math.log10(Number(BigInt(lamports))) - 9;
}

/** erfc(x), Numerical Recipes' erfcc (fractional error under 1.2e-7 everywhere). */
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** The bin a value falls in, for strictly ascending edges: 0 below edges[0], i in [edges[i-1], edges[i]), n above. */
function binOf(value, edges) {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value >= edges[mid]) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * @param {object} opts
 * @param {object} opts.task    task.json (places, chart_size, size.edges, reads)
 * @param {Array}  opts.marks   history marks, oldest first, each {at, rows:[{mint,market_cap_lamports}]}
 * @param {number} [opts.draws]
 * @param {number} [opts.seed]
 * @param {number} [opts.anonShare]    how much of each place to leave unnamed (the main lever)
 * @param {number} [opts.sd]           sd of a coin's log10 cap drift over one mark of horizon
 * @param {number} [opts.moverBoost]   weight on rank velocity when projecting places
 * @param {number} [opts.newcomerRate] mean newcomers reaching a top place per hour of horizon
 * @param {number} [opts.candCap]      most history coins carried into the simulation
 */
function buildForecast(opts) {
  const task = opts.task || {};
  const marks = (opts.marks || []).filter((m) => m && Array.isArray(m.rows) && m.rows.length > 0);
  const reads = (opts.reads || task.reads || []).map((s) => Date.parse(s)).filter(Number.isFinite);
  const edges = (task.size && task.size.edges) || [];
  const places = Math.min(PLACES_DEFAULT, task.places || PLACES_DEFAULT);
  const chartSize = task.chart_size || CHART_DEFAULT;
  const N = opts.draws || 20000;
  const seed = opts.seed === undefined ? 20261112 : opts.seed;
  const rng = makeRng(seed);
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  if (!marks.length || !reads.length) return { probabilities: [], top5: [], sizes: [] };

  // Tuned by tune.js against the house scorer on every (cut, future) fold the practice marks allow: 0.5 unnamed per
  // place and sd 0.3 score +1.56 nats over the persistence baseline. Deeper hedging loses, because the scorer
  // spreads the unnamed pool over ~95 chart ids; a tighter name loses, because half the places go to unseen coins.
  const ANON = opts.anonShare === undefined ? 0.5 : opts.anonShare;
  const SD = opts.sd === undefined ? 0.3 : opts.sd;
  const MOVER = opts.moverBoost === undefined ? 1 : opts.moverBoost;
  const RATE = opts.newcomerRate === undefined ? 6 : opts.newcomerRate;
  const CAND_CAP = opts.candCap || 160;

  const byCap = (rows) => [...rows].sort((a, b) => (BigInt(b.market_cap_lamports) > BigInt(a.market_cap_lamports) ? 1 : -1));
  const cutMark = marks[marks.length - 1];
  const cutAt = Date.parse(cutMark.at);
  const ranked = byCap(cutMark.rows);
  const rankOf = new Map(ranked.map((r, i) => [r.mint, i + 1]));

  const prev = marks.length >= 2 ? marks[marks.length - 2] : null;
  const prevRank = new Map(prev ? byCap(prev.rows).map((r, i) => [r.mint, i + 1]) : []);

  // Candidates: the top of the cut chart, plus fast risers from just outside it, so a coin climbing hard is in play.
  const cands = [];
  for (const r of ranked) {
    const rank = rankOf.get(r.mint);
    const was = prevRank.get(r.mint);
    const vel = was === undefined ? 0 : was - rank;
    if (rank <= CAND_CAP / 2 || (vel >= 3 && rank <= CAND_CAP)) {
      cands.push({ mint: r.mint, lc: log10Sol(r.market_cap_lamports), vel });
    }
    if (cands.length >= CAND_CAP) break;
  }

  // A newcomer has to be big to take a top place at all, so it is drawn around the caps already at the chart's top.
  const boundary = ranked.slice(Math.max(0, places - 2), Math.min(ranked.length, chartSize))
    .map((r) => log10Sol(r.market_cap_lamports));
  const boundaryMean = boundary.length ? boundary.reduce((a, b) => a + b, 0) / boundary.length : 0;

  const tally = reads.map(() => new Map());   // "place|mint" -> draws
  const binTally = reads.map(() => new Map()); // "place|bin"  -> draws

  for (let ri = 0; ri < reads.length; ri++) {
    const steps = Math.max(0, (reads[ri] - cutAt) / (10 * 60 * 1000));
    const hours = Math.max(1 / 6, steps / 6);
    const lambda = RATE * hours;
    for (let d = 0; d < N; d++) {
      const field = [];
      for (const c of cands) {
        const drift = MOVER * 0.02 * c.vel * steps;
        field.push({ mint: c.mint, lc: c.lc + drift + SD * Math.sqrt(Math.max(steps, 1)) * gauss() });
      }
      let nNew = 0;
      for (let k = 0; k < 12; k++) if (rng() < Math.min(0.95, lambda / 12)) nNew++;
      for (let k = 0; k < nNew; k++) field.push({ mint: `\u0000new${d}_${k}`, lc: boundaryMean + 0.35 * gauss() });
      field.sort((a, b) => b.lc - a.lc);
      for (let k = 0; k < places && k < field.length; k++) {
        const key = `${k + 1}|${field[k].mint}`;
        tally[ri].set(key, (tally[ri].get(key) || 0) + 1);
        const bkey = `${k + 1}|${binOf(field[k].lc, edges)}`;
        binTally[ri].set(bkey, (binTally[ri].get(bkey) || 0) + 1);
      }
    }
  }

  // Merge per place across reads: the score is the mean over reads, so each read contributes 1/reads of the place,
  // and one (id, place) row holds the sum - the format allows each pair only once.
  const named = new Map(); // "place|mint" -> p
  for (let ri = 0; ri < reads.length; ri++) {
    for (let place = 1; place <= places; place++) {
      let total = 0;
      const real = [];
      for (const [key, count] of tally[ri]) {
        const bar = key.indexOf('|');
        if (Number(key.slice(0, bar)) !== place) continue;
        const mint = key.slice(bar + 1);
        if (mint.charCodeAt(0) === 0) continue; // a newcomer: no name to give, it stays in the unnamed pool
        total += count;
        real.push({ mint, count });
      }
      if (!total) continue;
      const budget = (1 - ANON) / reads.length;
      for (const r of real) {
        const p = budget * (r.count / total);
        if (p <= 0) continue;
        const key = `${place}|${r.mint}`;
        named.set(key, (named.get(key) || 0) + p);
      }
    }
  }

  const probabilities = [];
  for (const [key, p] of named) {
    const bar = key.indexOf('|');
    const place = Number(key.slice(0, bar));
    const mint = key.slice(bar + 1);
    const rounded = Math.floor(p * MICRO) / MICRO;
    if (rounded > 0) probabilities.push({ mint, place, p: rounded });
  }
  probabilities.sort((a, b) => a.place - b.place || b.p - a.p);

  // Sizes: the log10 cap distribution of whatever holds each place, per place across all reads.
  const sizeTotals = new Map();
  for (let ri = 0; ri < reads.length; ri++) {
    for (const [key, count] of binTally[ri]) {
      sizeTotals.set(key, (sizeTotals.get(key) || 0) + count / reads.length);
    }
  }
  const perPlaceTotal = new Map();
  for (const [key, count] of sizeTotals) {
    const place = Number(key.slice(0, key.indexOf('|')));
    perPlaceTotal.set(place, (perPlaceTotal.get(place) || 0) + count);
  }
  const sizes = [];
  for (const [key, count] of [...sizeTotals].sort((a, b) => a[0].localeCompare(b[0]))) {
    const bar = key.indexOf('|');
    const place = Number(key.slice(0, bar));
    const bin = Number(key.slice(bar + 1));
    const total = perPlaceTotal.get(place) || 0;
    if (!total) continue;
    const p = Math.floor((count / total) * MICRO) / MICRO;
    if (p > 0) sizes.push({ place, bin, p });
  }
  sizes.sort((a, b) => a.place - b.place || a.bin - b.bin);

  // The point guess: the real coin most often drawn at each place at the last read, topped up from the cut chart.
  const pointTop = [];
  const lastTally = tally[reads.length - 1];
  for (let place = 1; place <= places; place++) {
    let best = null;
    let bestCount = -1;
    for (const [key, count] of lastTally) {
      const bar = key.indexOf('|');
      if (Number(key.slice(0, bar)) !== place) continue;
      const mint = key.slice(bar + 1);
      if (mint.charCodeAt(0) === 0) continue;
      if (count > bestCount) { bestCount = count; best = mint; }
    }
    if (best && !pointTop.includes(best)) pointTop.push(best);
  }
  for (const r of ranked.slice(0, places * 2)) {
    if (pointTop.length >= places) break;
    if (!pointTop.includes(r.mint)) pointTop.push(r.mint);
  }

  return { probabilities, top5: pointTop.slice(0, places), sizes };
}

module.exports = { buildForecast, FLOOR, binOf };

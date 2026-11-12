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
//
// This file is an ES module (package.json says "type": "module"), so it exports rather than assigns module.exports.

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

/** Standard normal CDF, via the same erfc the bin inds use. */
function normCdf(x) { return 0.5 * erfc(-x / Math.SQRT2); }

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
  const BINS = edges.length + 1;
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
  // CAPDRIFT: log10 cap growth of a top-chart coin per mark. Measured from the marks: the cap *at a place* climbs
  // +0.144 / +0.354 / +0.446 dex at steps 1 / 2 / 3 because newcomers keep arriving bigger, while a single coin's own
  // cap is flat (mean -0.014, sd 0.121 per mark). The gap is why the shipped size model sat a full dex too low.
  const CAPDRIFT = opts.capDrift === undefined ? 0.15 : opts.capDrift;
  const RATE = opts.newcomerRate === undefined ? 6 : opts.newcomerRate;
  // Analytic-size levers. DRIFT is the log10 cap gain at a place per mark of lead time, measured off the marks:
  // place 1 sits +0.144 dex after 1 mark, +0.354 after 2, +0.446 after 3 - concave, so the drift is applied through
  // a tanh saturation against the launch frontier rather than linearly. SIGMA is the spread around that centre, and
  // SKEW / SDSKEW let lower places sit a touch higher and wider (they are closer to the frontier already).
  const DRIFT = opts.drift === undefined ? 0.15 : opts.drift;
  const SIGMA = opts.sigmaSize === undefined ? 0.14 : opts.sigmaSize;
  const SKEW = opts.placeSkew === undefined ? 0.02 : opts.placeSkew;
  const SDSKEW = opts.sdSkew === undefined ? 0.2 : opts.sdSkew;
  const CAND_CAP = opts.candCap || 160;

  const byCap = (rows) => [...rows].sort((a, b) => (BigInt(b.market_cap_lamports) > BigInt(a.market_cap_lamports) ? 1 : -1));
  const cutMark = marks[marks.length - 1];
  const cutAt = Date.parse(cutMark.at);
  // Marks are 10 minutes apart; the size model converts a read's timestamp into whole steps with this.
  const STEP_MS = 10 * 60 * 1000;
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
  // boundaryMean is kept for the doc comment's sake; the draw that matters is the launch frontier below.
  const boundary = ranked.slice(Math.max(0, places - 2), Math.min(ranked.length, chartSize))
    .map((r) => log10Sol(r.market_cap_lamports));
  const boundaryMean = boundary.length ? boundary.reduce((a, b) => a + b, 0) / boundary.length : 0;

  // The launch frontier: what a coin that has just been minted is actually worth. Measured, not assumed.
  //
  // The first submission drew newcomers around boundaryMean - the caps at rank 4..100, i.e. 1.48..1.67 dex - and lost
  // 2.2 nats of size score for it. The practice marks say a newcomer that takes a top place arrives at 2.9..3.56 dex,
  // a full 1.5 dex above boundaryMean: the coins that reach the top are not the ones sitting mid-chart, they are new
  // launches that debut big. So the frontier is read off the marks themselves: for every consecutive pair, the cap of
  // each coin present in the later mark but in no earlier one, and the centre is the mean of the top quarter of those.
  const launchCaps = [];
  for (let i = 1; i < marks.length; i++) {
    const seen = new Set();
    for (let j = 0; j < i; j++) for (const r of marks[j].rows) seen.add(r.mint);
    for (const r of marks[i].rows) if (!seen.has(r.mint)) launchCaps.push(log10Sol(r.market_cap_lamports));
  }
  launchCaps.sort((a, b) => b - a);
  const frontierTop = launchCaps.slice(0, Math.max(1, Math.round(launchCaps.length / 4)));
  // Fall back to the cut's own top cap when no newcomer was ever seen, so the model never invents a scale.
  const NEWCAP = opts.newcomerCap === undefined
    ? (frontierTop.length ? frontierTop.reduce((a, b) => a + b, 0) / frontierTop.length : (ranked.length ? log10Sol(ranked[0].market_cap_lamports) : boundaryMean))
    : opts.newcomerCap;
  const NEWSD = opts.newcomerSd === undefined ? 0.30 : opts.newcomerSd;

  const tally = reads.map(() => new Map());   // "place|mint" -> draws
  const binTally = reads.map(() => new Map()); // "place|bin"  -> draws

  for (let ri = 0; ri < reads.length; ri++) {
    const steps = Math.max(0, (reads[ri] - cutAt) / (10 * 60 * 1000));
    const hours = Math.max(1 / 6, steps / 6);
    const lambda = RATE * hours;
    for (let d = 0; d < N; d++) {
      const field = [];
      for (const c of cands) {
        const drift = MOVER * 0.02 * c.vel * steps + CAPDRIFT * steps;
        field.push({ mint: c.mint, lc: c.lc + drift + SD * Math.sqrt(Math.max(steps, 1)) * gauss() });
      }
      let nNew = 0;
      for (let k = 0; k < 12; k++) if (rng() < Math.min(0.95, lambda / 12)) nNew++;
      for (let k = 0; k < nNew; k++) field.push({ mint: `\u0000new${d}_${k}`, lc: NEWCAP + NEWSD * gauss() });
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
  //
  // Two ways to build that document. 'mc' merges the per-read tallies, which is only right when the per-read
  // distributions coincide. 'analytic' (the default) writes the document from the physics.
  //
  // The physics, read straight off the marks (log10 SOL at each place):
  //   mark   P1     P2     P3     P4     P5     spread
  //   20:10  3.036  2.122  1.984  1.974  1.847  1.19
  //   20:20  3.115  2.916  2.638  2.385  2.160  0.96
  //   20:30  3.258  3.185  3.178  3.122  3.096  0.16
  //   20:40  3.468  3.254  3.225  3.185  3.115  0.35
  //   20:50  3.561  3.316  3.309  3.304  3.282  0.28
  // The places converge on a common level: P5 climbs +0.36/mark while P1 climbs +0.13/mark and the spread collapses
  // from 1.19 dex to 0.28. That is the top of the chart being repopulated by big launches, so each place relaxes
  // from its cut cap toward one target level A with time constant TAU.
  //
  // Critically the document is the MIXTURE of the per-read Gaussians, not the Gaussian at the mean read. The scorer
  // averages ln P over seven reads against one submitted document, so by Jensen the mixture is what it pays for.
  // Building it at the mean step and calling the spread sd is the mistake the first submission made.
  //
  // The parameters are the minimax choice from minimax.js, not the in-sample optimum. The in-sample fit wants
  // sigma0 = 0.03 dex (under one bin) and scores -10.07, but it collapses to -32 if A misses high by half a dex; six
  // practice reads cannot pin A that hard and the live window runs four reads longer than anything checkable. The
  // minimax set gives up ~1 nats in the rosy case to lift the worst case from -34 to -16.9 (see robust.js).
  let sizes;
  if ((opts.sizeModel || 'analytic') === 'analytic') {
    const A_LEVEL = opts.sizeLevel === undefined ? 3.35 : opts.sizeLevel;
    const TAU = opts.sizeTau === undefined ? 2 : opts.sizeTau;
    const SIGMA0 = opts.sigmaSize === undefined ? 0.14 : opts.sigmaSize;
    const SIGMA1 = opts.sigmaGrowth === undefined ? 0.02 : opts.sigmaGrowth;
    const D1 = opts.placeSkew === undefined ? 0.2 : opts.placeSkew;
    const D5 = opts.lastSkew === undefined ? 0 : opts.lastSkew;
    // Step of each read, in marks after the cut. Reads are every 10 min and the task fixes the step size, but derive
    // it rather than assume, so a different grid stays correct.
    const stepOf = (r) => Math.max(0, (r - cutAt) / STEP_MS);
    sizes = [];
    for (let k = 0; k < places; k++) {
      const cap = ranked.length ? log10Sol(ranked[Math.min(k, ranked.length - 1)].market_cap_lamports) : boundaryMean;
      const target = A_LEVEL + (k === 0 ? D1 : 0) + (k === places - 1 ? D5 : 0);
      // Mixture over the reads the scorer will actually use.
      const raw = new Array(BINS).fill(0);
      for (const r of reads) {
        const t = stepOf(r);
        const travelled = 1 - Math.exp(-t / Math.max(0.2, TAU));
        const mu = cap + (target - cap) * travelled;
        const sd = Math.max(0.025, SIGMA0 + SIGMA1 * t);
        let tot = 0;
        const g = new Array(BINS).fill(0);
        for (let b = 0; b < BINS; b++) {
          const lo = b === 0 ? -Infinity : edges[b - 1];
          const hi = b === BINS - 1 ? Infinity : edges[b];
          const q = (hi === Infinity ? 1 : normCdf((hi - mu) / sd)) - (lo === -Infinity ? 0 : normCdf((lo - mu) / sd));
          g[b] = q > 0 ? q : 0;
          tot += g[b];
        }
        for (let b = 0; b < BINS; b++) raw[b] += (g[b] / (tot || 1)) / reads.length;
      }
      for (let b = 0; b < BINS; b++) {
        const p = Math.floor((raw[b] || 0) * MICRO) / MICRO;
        if (p > 0) sizes.push({ place: k + 1, bin: b, p });
      }
    }
    sizes.sort((a, b) => a.place - b.place || a.bin - b.bin);
  } else {
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
  sizes = [];
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
  }

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

export { buildForecast, FLOOR, binOf };

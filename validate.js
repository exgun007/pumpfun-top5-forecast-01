// validate.js — a local stand-in for the house's parseRanked/parseSizes, over the file the entry writes.
//
// Usage: node validate.js out/forecast.json
//
// The grader rejects the whole document (and floors every place) on the first format fault it finds, so this checks the
// same rules before shipping:
//   * exactly three top-level keys: probabilities, top5, sizes;
//   * every probabilities row is {mint: non-empty string, place: integer 1..5, p: number > 0 and <= 1};
//   * each place 1..5 appears at least once, no (mint, place) pair twice, and each place's p sums to <= 1 (1e-9);
//   * every sizes row is {place: integer 1..5, bin: integer 0..edges.length, p: number > 0 and <= 1}, each place
//     appears, no (place, bin) pair twice, and each place's p sums to <= 1 (1e-9).
// It differs from parseRanked in one way on purpose: the house accepts p = 0, this rejects it, because a zero row
// spends a row but earns nothing.
//
// The bin range comes from the kit's task.json (81 edges -> bins 0..81), found through MAKEFUN_INPUT_DIR, TASK_JSON or
// the default kit path. Exits 0 with one summary line, or 1 with every failure listed.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SUM_TOLERANCE = 1e-9;
const PLACES = 5;
const KEYS = ['probabilities', 'sizes', 'top5']; // sorted, as parseRanked compares them

const fail = [];
const bad = (why) => { fail.push(why); return false; };
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));

// ---------------------------------------------------------------- the bin edges, from the task
function loadEdges() {
  const dir = process.env.MAKEFUN_INPUT_DIR;
  const cands = [
    process.env.TASK_JSON,
    dir ? join(dir, 'task.json') : null,
    '/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit/input/task.json',
  ].filter(Boolean);
  for (const c of cands) {
    if (!existsSync(c)) continue;
    const task = JSON.parse(readFileSync(c, 'utf8'));
    const edges = task?.size?.edges;
    if (Array.isArray(edges) && edges.length > 0) return { edges, from: c };
  }
  throw new Error(`no task.json with size.edges among ${JSON.stringify(cands)}`);
}

// ---------------------------------------------------------------- probabilities
function checkProbabilities(doc) {
  const list = doc.probabilities;
  if (!Array.isArray(list)) return bad('probabilities is not a list');
  const mass = new Map();
  const seen = new Set();
  let n = 0;
  for (const [i, row] of list.entries()) {
    if (!isObject(row)) { bad(`probabilities[${i}] is not an object`); continue; }
    const keys = Object.keys(row).sort();
    if (keys.length !== 3 || keys[0] !== 'mint' || keys[1] !== 'p' || keys[2] !== 'place') {
      bad(`probabilities[${i}] has keys ${JSON.stringify(keys)}, not exactly ["mint","p","place"]`);
      continue;
    }
    const { mint, place, p } = row;
    let ok = true;
    if (typeof mint !== 'string' || mint.length === 0) ok = bad(`probabilities[${i}].mint is not a non-empty string`);
    if (!Number.isInteger(place) || place < 1 || place > PLACES) ok = bad(`probabilities[${i}].place ${show(place)} is not an integer from 1 to ${PLACES}`);
    if (typeof p !== 'number' || !Number.isFinite(p) || !(p > 0) || p > 1) ok = bad(`probabilities[${i}].p ${show(p)} is not a number above 0 and at most 1`);
    if (!ok) continue;
    const pair = `${place}|${mint}`;
    if (seen.has(pair)) { bad(`${mint} is named twice at place ${place}`); continue; }
    seen.add(pair);
    mass.set(place, (mass.get(place) ?? 0) + p);
    n += 1;
  }
  for (let place = 1; place <= PLACES; place++) {
    if (!mass.has(place)) bad(`no probabilities row for place ${place}`);
    else if (mass.get(place) > 1 + SUM_TOLERANCE) bad(`place ${place}'s probabilities add up to ${mass.get(place)}, more than 1`);
  }
  return { n, mass };
}

// ---------------------------------------------------------------- sizes
function checkSizes(doc, edges) {
  const list = doc.sizes;
  if (!Array.isArray(list)) return bad('sizes is not a list');
  const bins = edges.length + 1;
  const mass = new Map();
  const seen = new Set();
  let m = 0;
  for (const [i, row] of list.entries()) {
    if (!isObject(row)) { bad(`sizes[${i}] is not an object`); continue; }
    const keys = Object.keys(row).sort();
    if (keys.length !== 3 || keys[0] !== 'bin' || keys[1] !== 'p' || keys[2] !== 'place') {
      bad(`sizes[${i}] has keys ${JSON.stringify(keys)}, not exactly ["bin","p","place"]`);
      continue;
    }
    const { place, bin, p } = row;
    let ok = true;
    if (!Number.isInteger(place) || place < 1 || place > PLACES) ok = bad(`sizes[${i}].place ${show(place)} is not an integer from 1 to ${PLACES}`);
    if (!Number.isInteger(bin) || bin < 0 || bin > edges.length) ok = bad(`sizes[${i}].bin ${show(bin)} is not an integer from 0 to ${edges.length}`);
    if (typeof p !== 'number' || !Number.isFinite(p) || !(p > 0) || p > 1) ok = bad(`sizes[${i}].p ${show(p)} is not a number above 0 and at most 1`);
    if (!ok) continue;
    const pair = `${place}|${bin}`;
    if (seen.has(pair)) { bad(`place ${place} names bin ${bin} twice`); continue; }
    seen.add(pair);
    mass.set(place, (mass.get(place) ?? 0) + p);
    m += 1;
  }
  for (let place = 1; place <= PLACES; place++) {
    if (!mass.has(place)) bad(`no sizes row for place ${place}`);
    else if (mass.get(place) > 1 + SUM_TOLERANCE) bad(`place ${place}'s sizes add up to ${mass.get(place)}, more than 1`);
  }
  return { m, mass, bins };
}

// ---------------------------------------------------------------- top5: the point guess the grader reads too
function checkTop5(doc) {
  const top = doc.top5;
  if (!Array.isArray(top)) return bad('top5 is not a list');
  if (top.length !== PLACES) bad(`top5 holds ${top.length} ids, not ${PLACES}`);
  if (!top.every((v) => typeof v === 'string' && v.length > 0)) bad('top5 holds a value that is not a non-empty string');
  else if (new Set(top).size !== top.length) bad('top5 repeats an id');
}

// ---------------------------------------------------------------- run
function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: node validate.js <forecast.json>'); process.exit(1); }
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`validate: cannot read ${file}: ${err.message}`);
    process.exit(1);
  }
  if (!isObject(doc)) {
    console.error('validate: the forecast is not one JSON object');
    process.exit(1);
  }

  const have = Object.keys(doc).sort();
  if (have.length !== KEYS.length || have.some((k, i) => k !== KEYS[i])) {
    bad(`the forecast's keys are ${JSON.stringify(have)}, not exactly ${JSON.stringify(KEYS)}`);
  }

  let edges = [];
  let from = 'unknown';
  try {
    ({ edges, from } = loadEdges());
  } catch (err) {
    bad(`bin edges unavailable: ${err.message}`);
  }

  const probs = Array.isArray(doc.probabilities) ? checkProbabilities(doc) || {} : { n: 0, mass: new Map() };
  const sizes = edges.length && Array.isArray(doc.sizes) ? checkSizes(doc, edges) || {} : { m: 0, mass: new Map(), bins: 0 };
  if (Array.isArray(doc.top5) || 'top5' in doc) checkTop5(doc);

  if (fail.length) {
    console.error(`validate: ${fail.length} failure(s) in ${file}`);
    for (const why of fail) console.error(`  - ${why}`);
    process.exit(1);
  }

  const perPlace = (mass) => [...mass.entries()].sort((a, b) => a[0] - b[0])
    .map(([place, v]) => `${place}:${v.toFixed(6)}`).join(' ');
  console.log(
    `validate: OK ${probs.n || 0} probability rows, ${sizes.m || 0} size rows, ` +
    `per-place named mass ${perPlace(probs.mass || new Map())}; ` +
    `size mass ${perPlace(sizes.mass || new Map())} over ${sizes.bins || 0} bins ` +
    `(edges ${edges[0]}..${edges[edges.length - 1]} step ${(edges[1] - edges[0]).toFixed(2)}, ${from})`,
  );
  process.exit(0);
}

main();

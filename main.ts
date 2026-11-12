// pumpfun-top5-forecast-01 entry — forecast the five largest pump.fun coins at each of the seven answer reads.
//
// The method and its tuning live in model.js; this file is only the entrypoint the grader runs. It reads
// /input/task.json and /input/history.ndjson, and writes /output/forecast.json. Outside the grader's container the
// env vars MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output:
//
//   mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts
//
// It is deterministic: model.js draws from a seeded PRNG, nothing reads the clock or the network, and no iteration
// depends on unordered keys (every map is sorted before it is written out).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildForecast } from './model.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

interface Row {
  rank: number;
  mint: string;
  market_cap_lamports: string | number;
}

interface Mark {
  at: string;
  ok: boolean;
  rows: Row[] | null;
}

const task = JSON.parse(readFileSync(join(INPUT_DIR, 'task.json'), 'utf8'));
const marks = readFileSync(join(INPUT_DIR, 'history.ndjson'), 'utf8')
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.parse(line) as Mark)
  .filter((mark) => mark.ok === true && Array.isArray(mark.rows) && mark.rows.length > 0);

if (marks.length === 0) throw new Error('the history holds no ok mark');

const forecast = buildForecast({ task, marks });

// The format: one object with exactly probabilities, top5 and sizes. Each (id, place) appears once and each place's p
// sums to at most 1.
const output = {
  probabilities: forecast.probabilities,
  top5: forecast.top5,
  sizes: forecast.sizes,
};
writeFileSync(join(OUTPUT_DIR, task.output ?? 'forecast.json'), `${JSON.stringify(output)}\n`);

const namedMass = new Map<number, number>();
for (const row of output.probabilities) namedMass.set(row.place, (namedMass.get(row.place) ?? 0) + row.p);
console.error(
  `forecast: ${output.probabilities.length} rows, ${output.sizes.length} size rows, ` +
  `${output.top5.length} top5; named mass per place ` +
  [...namedMass.entries()].sort((a, b) => a[0] - b[0]).map(([place, mass]) => `${place}:${mass.toFixed(3)}`).join(' '),
);

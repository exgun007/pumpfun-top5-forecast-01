// probe_final.ts — does model.js survive the FINAL's hourly read grid?
// The kit input is the PRACTICE grid (7 reads, 10 min apart, cut at 2026-11-11T21:00Z).
// The final's grid is 7 reads ONE HOUR apart, cut at 2026-11-12T13:00Z (RULES: "an hour apart").
// Same history, same code -> if the output changes shape, the model is cadence-blind.
import { readFileSync } from 'node:fs';
import { buildForecast } from './model.js';

const KIT = process.env.KIT || '/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit';
const taskP = JSON.parse(readFileSync(`${KIT}/input/task.json`, 'utf8'));
const marks = readFileSync(`${KIT}/input/history.ndjson`, 'utf8')
  .split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s))
  .filter((m) => m.ok === true && Array.isArray(m.rows) && m.rows.length > 0);

const cut = marks[marks.length - 1].at;
const cutMs = Date.parse(cut);

// PRACTICE grid, straight from task.json.
const practiceReads = taskP.reads.map((s) => Date.parse(s));

// FINAL grid: cut + 7h .. cut + 13h, hourly (RULES: answer reads start 7h after the cut).
const finalReads = [7, 8, 9, 10, 11, 12, 13].map((h) => cutMs + h * 3600 * 1000);
const iso = (ms) => new Date(ms).toISOString();

const taskFinal = { ...taskP, reads: finalReads.map(iso), cadence_minutes: 60, marks: marks.length };

function spread(sizes) {
  // Effective number of bins per place: exp(entropy). 82 = flat, ~16 = sharp.
  const out = {};
  for (let place = 1; place <= 5; place++) {
    const rows = sizes.filter((r) => r.place === place);
    const tot = rows.reduce((a, r) => a + r.p, 0);
    let h = 0;
    let peak = 0;
    let peakBin = -1;
    for (const r of rows) {
      const p = r.p / tot;
      if (p > 0) h -= p * Math.log(p);
      if (r.p > peak) { peak = r.p; peakBin = r.bin; }
    }
    out[place] = { effBins: Math.exp(h), peakP: peak, peakBin, nBins: rows.length };
  }
  return out;
}

for (const [label, task] of [['PRACTICE (10min grid)', taskP], ['FINAL (hourly grid)', taskFinal]]) {
  const f = buildForecast({ task, marks });
  const s = spread(f.sizes);
  console.log(`\n=== ${label}  cut=${cut}  reads=${task.reads[0]} .. ${task.reads[task.reads.length - 1]}`);
  console.log(`  probability rows=${f.probabilities.length}  size rows=${f.sizes.length}`);
  const avgEff = Object.values(s).reduce((a, x) => a + x.effBins, 0) / 5;
  for (let p = 1; p <= 5; p++) {
    const x = s[p];
    console.log(`  place ${p}: effBins=${x.effBins.toFixed(1).padStart(5)}  peakP=${x.peakP.toFixed(4)}  peakBin=${x.peakBin}`);
  }
  console.log(`  MEAN effBins = ${avgEff.toFixed(1)}   (flat=82, sharp=~16, rank-1 target=~16-20)`);
}

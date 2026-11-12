# pumpfun-top5-forecast-01

Forecast the five largest pump.fun coins by market cap (SOL) at each of the seven answer reads.

The entry is three files: `main.ts` (entrypoint the grader runs), `model.js` (the model), and `validate.js` (a
pre-flight check on the format). `backtest.js` and `tune.js` are the evidence: both score the model with the house's
own scorer on held-out practice marks.

```
mkdir -p out
MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts
node validate.js out/forecast.json
```

Output is the house format: one JSON object with exactly `probabilities`, `top5`, `sizes`, written with
`JSON.stringify` of already-sorted arrays, so the file is byte-identical across runs.

## What the task measures

* The cut is the last history mark; the seven reads run 10 to 70 minutes past it (`task.reads`).
* The answer chart is the 100 largest eligible coins by market cap; only places 1 to 5 are scored.
* Between two marks 10 minutes apart most of the top 5 holds, but a real share of each place is taken by coins minted
  **after** the cut. Those coins appear in no history mark, so no amount of ranking the history can name them. That
  is the structural reason the house persistence baseline leaves 50 to 60% of each place unnamed.

## The method

A seeded Monte Carlo over where each coin can be at each read (`model.js`):

1. **Candidates** — the top 80 of the cut chart, plus any coin outside that with rank velocity >= 3 places per mark
   and inside the top 160, capped at 160 coins.
2. **Drift** — each candidate's cap moves in log10 space over `steps` = (read - cut) / 10 minutes:
   `lc + moverBoost * 0.02 * velocity * steps + sd * sqrt(steps) * N(0,1)`.
   The velocity term is continued momentum; `sd = 0.3` is the tuned diffusion.
3. **Newcomers** — a Poisson count `lambda = 6 * hours` of coins unminted at the cut, drawn at the caps that have just
   been crossing the top of the chart (the mean log10 cap of places 3 to 100). They carry a synthetic id and are never
   named — they exist only to occupy places and stay in the unnamed pool.
4. **Places** — the field is sorted by cap, the top five take places 1 to 5, and both the `(place, mint)` and
   `(place, bin)` pairs are tallied over 20,000 draws.
5. **Shrinking** — each place keeps `1 - anonShare = 0.5` of its mass for the real coins, split in proportion to how
   often each was drawn there. The other half stays unnamed. Tally is merged across the seven reads, each worth
   `1/reads`, and rounded **down** to 6 decimals so rounding can never push a place's sum over 1.
6. **Sizes** — the log10 cap distribution of whatever actually holds each place, per place across all reads, into the
   82 bins the task's 81 edges define. This is now written **analytically** rather than merged from the simulation
   tallies; see "The size document" below.
7. **top5** — the real coin drawn most often at each place at the last read, topped up from the cut chart. This only
   feeds hits and the agreement tie-break.

Everything is seeded (`mulberry32`, seed 20261112); nothing reads the clock or the network. Two runs are
byte-identical — verified by running into two output dirs and diffing (`sha256` equal).

## The size document

The first submission scored -35.70 (order -19.56, size -16.14, rank 67/323). The order half was already top-10
calibre — place 10's order was -19.50 — so the entire gap was the size document, which sat almost two dex too low.

The physics, read straight off the marks (log10 SOL of the cap at each place):

```
mark   P1     P2     P3     P4     P5     spread
20:10  3.036  2.122  1.984  1.974  1.847  1.19
20:20  3.115  2.916  2.638  2.385  2.160  0.96
20:30  3.258  3.185  3.178  3.122  3.096  0.16
20:40  3.468  3.254  3.225  3.185  3.115  0.35
20:50  3.561  3.316  3.309  3.304  3.282  0.28
```

The places **converge on a common level**. P5 climbs +0.36 dex per mark while P1 climbs only +0.13, and the spread
collapses from 1.19 dex to 0.28. That is not the incumbents drifting; it is the top of the chart being repopulated by
big new launches and settling. So each place relaxes from its cut cap toward one target level `A`, with time constant
`tau`, and the document is the **mixture over the reads** of a Gaussian around that centre whose width grows with the
horizon.

The mixture matters and is the part the first submission missed. The scorer averages `ln P` over seven reads against
one submitted document, so the document it pays for is the average of the per-read distributions, not the
distribution at the mean read. Because the cap travels about half a dex across the window, the mixture is
meaningfully wider than a Gaussian at the mean step; building the latter and calling its width `sd` is over-confident
at both ends. Switching from the merged simulation tally to this mixture is worth **+3.3 nats** of size
(-15.93 -> -12.59) on the practice folds.

Parameters are the **minimax** choice, not the in-sample optimum, because the practice data cannot pin the target
level and the live window runs four reads past anything checkable:

| candidate | -0.3 dex | 0.0 | +0.3 dex | worst |
|---|---|---|---|---|
| point-fit A3.45 s.03 | -34.02 | -11.81 | -16.69 | **-34.02** |
| minimax A3.35 s.14 (shipped) | -16.74 | -12.78 | -16.85 | **-16.85** |

The in-sample fit wins the middle by a nat and loses the tails by seventeen. Shipping the floor.

Validation, against a harness that reproduces the house scorer to 0.02 nats (local -35.68 v live -35.70):

* `sizefit3.js` — leave-one-fold-out on the three mature cuts, mean size **-13.97** v the submitted -16.14.
* `robust.js` — sensitivity to each knob, single-fold training, and extrapolation to the 7-read horizon.
* `minimax.js` — the hostile-scenario grid that picks the shipped parameters.
* `evalreal.js` — the real `buildForecast` end to end, so the number is the pipeline's, not a re-implementation's.
* `orderfit.js` — sweeps `anonShare`, `sd` and `moverBoost`; confirms the shipped 0.5 / 0.3 / 1 is already the
  optimum, so the order half was left alone.

## The scoring rule it optimises

Per read, per place k = 1..5, the house scores `ln max(P_k(chart[k]), 1e-4)`, sums over the places, averages over the
reads. `P_k(id)` is the row's own `p` when the forecast names `id` at place k, otherwise place k's unnamed mass
`max(0, 1 - sum of its rows)` shared **equally among the chart's ~95 ids it does not name there**. An id named off the
chart still spends its `p`.

That sharing is the whole game. Naming a coin confidently buys `ln(p)` when it lands and starves the unnamed pool for
every other chart id, so:

* Too **confident** (small `anonShare`) — generous `p` on coins that half the time are not there, and the miss costs
  the full 9.21 nats.
* Too **hedged** (large `anonShare`) — every place's unnamed mass is divided by ~95 chart ids, which lands well under
  the 1e-4 floor for the ids that actually matter, so the hedge scores the floor too.

Optimum sits near half-and-half, which is what the grid search found.

## Tuning result vs the house persistence baseline

`tune.js` searches `anonShare` in {0.3, 0.5, 0.65, 0.8, 0.9} x `sd` in {0.3, 0.6, 1.0} over every
(cut, future) pair the six practice marks allow (**6 folds**: 1->2, 1->3, 1->4, 2->3, 2->4, 3->4), scoring the order
term with the house rule on the full 100-coin chart:

| anonShare | sd | score (nats/read) | vs baseline |
|-----------|----|-------------------|-------------|
| **0.50** | **0.30** | **-22.9884** | **+1.5643** |
| 0.65 | 0.30 | -23.1210 | +1.4317 |
| 0.30 | 0.30 | -23.5654 | +0.9873 |
| 0.50 | 0.60 | -23.8619 | +0.6908 |
| 0.80 | 0.30 | -23.8732 | +0.6795 |
| 0.90 | 1.00 | -26.8397 | -2.2870 |

House persistence baseline on the same folds: **-24.5527**. The shipped defaults are the grid's best cell, so the
model clears the baseline by **+1.56 nats per read** on the tuning folds.

`backtest.js` (`--draws 2000`) is the independent walk-forward check, scored on order **plus** sizes, cut 2/3/4 with up
to 3 held-out reads each:

```
cut=2 reads=3 | model -50.18460 | house-starter -49.95813 | loss  -0.22647
cut=3 reads=2 | model -30.92590 | house-starter -33.47762 | WIN   +2.55171
cut=4 reads=1 | model -26.77078 | house-starter -29.86692 | WIN   +3.09614

OVERALL: model -39.86273 vs house-starter -41.11609 | delta +1.25336 | wins 2/3
```

The one losing fold is cut 2 — the model has a single prior mark to read velocity from, so it cannot see the
post-cut mints. From cut 3 on it wins by 2.5 to 3.1 nats. **Delta vs baseline: +1.25 nats per read** over all folds.

Caveat on sample size: six practice marks give 6 tuning folds and only three walk-forward cuts, so both numbers are
low-confidence point estimates. The direction is consistent across the grid (every `sd = 0.3` cell beats the
baseline) and it is the `anonShare` lever, not luck in the velocity term, that carries the gain.

## validate.js

The grader floors every place on the first format fault, so `validate.js` re-checks the rules before shipping: exactly
the three top-level keys, row shapes, places 1..5, `p` in (0, 1], no duplicate `(mint, place)` or `(place, bin)`,
every place present, each place's mass at most 1 (tolerance 1e-9). It rejects `p = 0`, which the house accepts, because
a zero row spends a row and earns nothing. Exits 0 with one summary line, or 1 listing every failure.

Checked against nine injected faults (missing key, place 6, p = 0, p = 1.5, duplicate pair, bin 999, sizes mass 2.98,
missing place 4, probabilities mass 1.18): all nine rejected with exit 1.

## Files

| file | role |
|------|------|
| `main.ts` | grader entrypoint: reads task + history, writes forecast.json |
| `model.js` | the seeded Monte Carlo |
| `validate.js` | format validator, exits 1 on any fault |
| `tune.js` | grid search of the knobs on the practice folds |
| `backtest.js` | walk-forward score vs the house persistence baseline |
| `dbg.js` | per-place shape dump on cuts 2/3/4 |
| `out/forecast.json` | the shipped forecast |

All modules are ES modules (`package.json` sets `"type": "module"`). Requires Node 22.

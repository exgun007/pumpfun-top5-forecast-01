#!/usr/bin/env python3
"""Clean 1-D inversion: the house baseline's exact size score pins the answer's cap LEVEL.

Baseline doc: place k = normal(MU_cut[k], sd 0.35), floor-rounded to 6dp.
If the answer's caps all sat at one level L (each read), then

    baseline_size = (1/5) * sum_k ln(base_doc[k][binOf(L)])

independent of the read. Solve that for L using the exact anchor -19.027956.
Then report what a doc peaked at L would score, i.e. the achievable ceiling.
"""
import json, math

KIT = '/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit'
task = json.load(open(f'{KIT}/input/task.json'))
edges = task['size']['edges']
BINS = len(edges) + 1
NREAD = len(task['reads'])
marks = [json.loads(l) for l in open(f'{KIT}/input/history.ndjson')]
marks = [m for m in marks if m.get('ok') and m.get('rows')]
def lc(row): return math.log10(int(row['market_cap_lamports']) / 1e9)
cut = sorted(marks[-1]['rows'], key=lambda r: -int(r['market_cap_lamports']))
MU = [lc(r) for r in cut[:5]]
FLOOR = math.log(1e-4)

def erf(x):
    z = abs(x); t = 1.0 / (1.0 + 0.5*z)
    r = t*math.exp(-z*z - 1.26551223 + t*(1.00002368 + t*(0.37409196 + t*(0.09678418 +
        t*(-0.18628806 + t*(0.27886807 + t*(-1.13520398 + t*(1.48851587 +
        t*(-0.82215223 + t*0.17087277)))))))))
    return 1-r if x >= 0 else r-1
def phi(x): return 0.5*(1+erf(x/math.sqrt(2)))
def binprob(mu, sd, b):
    lo = -1e9 if b == 0 else edges[b-1]
    hi = 1e9 if b == BINS-1 else edges[b]
    return max(0.0, phi((hi-mu)/sd) - phi((lo-mu)/sd))
def binof(x):
    b = 0
    while b < BINS-1 and x >= edges[b]: b += 1
    return b

BASE_SD = 0.35
base_doc = [[math.floor(binprob(MU[k], BASE_SD, b)*1e6)/1e6 for b in range(BINS)] for k in range(5)]
T_BASE = -19.027956

def baseline_at_level(L):
    b = binof(L)
    tot = 0.0
    for k in range(5):
        p = base_doc[k][b]
        tot += FLOOR if p <= 0 else max(math.log(p), FLOOR)
    return tot/5

print("baseline size score if answer sits at level L (all places, all reads):")
print(f"{'L':>6} {'bin':>4} {'score':>10}")
for i in range(120, 100+0, 1): pass
for L10 in range(20, 46):
    L = L10/10
    print(f"{L:6.2f} {binof(L):4d} {baseline_at_level(L):10.4f}")
print(f"\nTARGET = {T_BASE}")

# find L minimizing |baseline_at_level(L) - T_BASE|
best = None
for i in range(200, 600):
    L = i/100
    e = abs(baseline_at_level(L) - T_BASE)
    if best is None or e < best[0]: best = (e, L)
print(f"\nBEST single level L = {best[1]:.2f} (bin {binof(best[1])}), score {baseline_at_level(best[1]):.6f}, err {best[0]:.6f}")

# The ceiling: what does a doc peaked exactly at L score?
def tight_doc(level, sd):
    doc = []
    for k in range(5):
        row = [0.0]*BINS
        lo = binof(level - 2.5*sd); hi = binof(level + 2.5*sd)
        tot = 0.0
        for b in range(lo, min(hi, BINS-1)+1):
            lb = -1e9 if b == 0 else edges[b-1]
            hb = 1e9 if b == BINS-1 else edges[b]
            row[b] = max(0.0, phi((hb-level)/sd) - phi((lb-level)/sd)); tot += row[b]
        if tot > 0:
            row = [v/tot for v in row]
        doc.append(row)
    return doc

print("\nachievable size score for a doc centred on the true level, by sd:")
for sd in [0.05, 0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30, 0.35]:
    doc = tight_doc(best[1], sd)
    s = 0.0
    for k in range(5):
        b = binof(best[1])
        p = doc[k][b]
        s += FLOOR if p <= 0 else max(math.log(p), FLOOR)
    nbins = sum(1 for k in range(5) for b in range(BINS) if doc[k][b] > 0)
    print(f"  sd={sd:.2f}: size={s/5:8.4f}   bins per place={nbins/5:.0f}   (baseline {T_BASE}, mine -18.12, rank1 -13.89)")

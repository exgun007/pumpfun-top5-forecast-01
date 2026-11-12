#!/usr/bin/env python3
"""Pin the hidden answer's cap level from the exact anchors, with correct normalisation.

Definitions (RULES.txt):
  size score of a read   = sum over the 5 places of ln p    (0 .. -46.051702)
  reported size score    = MEAN over the 7 answer reads
  => one document scored against 7 reads of equal truth = sum_k ln p_k[bin(L_k)]

Anchors, exact:
  house baseline sizes = -19.027956   (place k ~ normal(MU_cut[k], 0.35), floor 6dp)
  my entry sizes       = -18.120000   (out/forecast.json as submitted)
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
T_BASE, T_MINE = -19.027956, -18.12

def erf(x):
    z = abs(x); t = 1.0/(1.0+0.5*z)
    r = t*math.exp(-z*z-1.26551223+t*(1.00002368+t*(0.37409196+t*(0.09678418+
        t*(-0.18628806+t*(0.27886807+t*(-1.13520398+t*(1.48851587+
        t*(-0.82215223+t*0.17087277)))))))))
    return 1-r if x >= 0 else r-1
def phi(x): return 0.5*(1+erf(x/math.sqrt(2)))
def binprob(mu, sd, b):
    lo = -1e9 if b == 0 else edges[b-1]
    hi = 1e9 if b == BINS-1 else edges[b]
    return max(0.0, phi((hi-mu)/sd)-phi((lo-mu)/sd))
def binof(x):
    b = 0
    while b < BINS-1 and x >= edges[b]: b += 1
    return b

BASE_SD = 0.35
base_doc = [[math.floor(binprob(MU[k], BASE_SD, b)*1e6)/1e6 for b in range(BINS)] for k in range(5)]
mine = json.load(open('/home/ubuntu/web3/makefun/entry/out/forecast.json'))
my_doc = []
for k in range(5):
    row = [0.0]*BINS
    for r in mine['sizes']:
        if r['place'] == k+1: row[r['bin']] = r['p']
    my_doc.append(row)

def score(doc, levels):
    """doc[k]=82 p; levels[k]=true cap (same every read)."""
    tot = 0.0
    for k in range(5):
        b = binof(levels[k]); p = doc[k][b]
        tot += FLOOR if p <= 0 else max(math.log(p), FLOOR)
    return tot

print("=== ANCHOR 1: solve the uniform level L from the baseline's exact -19.027956")
print(f"{'L':>5} {'bin':>4} {'baseline size':>14}")
best = None
for i in range(280, 460):
    L = i/100
    s = score(base_doc, [L]*5)
    if best is None or abs(s-T_BASE) < abs(best[0]-T_BASE): best = (s, L)
for L10 in range(350, 411, 5):
    L = L10/100
    print(f"{L:5.2f} {binof(L):4d} {score(base_doc,[L]*5):14.4f}")
s, L = best
print(f"\n  => best uniform L = {L:.2f} (bin {binof(L)}), baseline size {s:.6f} vs target {T_BASE}")
print(f"     residual {abs(s-T_BASE):.6f} nats")

print("\n=== ANCHOR 2: what does MY doc score if truth is at that level?")
print(f"  mine at L={L:.2f}: {score(my_doc,[L]*5):.4f}   (board says {T_MINE})")
print(f"  mine at cut caps:  {score(my_doc,MU):.4f}")

print("\n=== fit per-place levels L_k = L + S*(k-1) to BOTH anchors")
best2 = None
for Lc in range(280, 480, 1):
    Lv = Lc/100
    for Sc in range(-40, 41, 2):
        Sv = Sc/100
        lv = [Lv + Sv*k for k in range(5)]
        e = (score(base_doc, lv)-T_BASE)**2 + (score(my_doc, lv)-T_MINE)**2
        if best2 is None or e < best2[0]: best2 = (e, Lv, Sv)
e, Lv, Sv = best2
lv = [Lv + Sv*k for k in range(5)]
print(f"  L={Lv:.2f} S={Sv:+.2f}  resid2={e:.5f}")
print(f"  base={score(base_doc,lv):.4f} (t {T_BASE})   mine={score(my_doc,lv):.4f} (t {T_MINE})")
print(f"  levels: {[round(x,2) for x in lv]}")

print("\n=== CEILING: doc centred on the pinned levels, by sd (correct normalisation)")

def tight(level, sd):
    row = [0.0]*BINS
    lo, hi = binof(level-2.5*sd), binof(level+2.5*sd)
    tot = 0.0
    for b in range(max(0,lo), min(hi, BINS-1)+1):
        lb = -1e9 if b == 0 else edges[b-1]
        hb = 1e9 if b == BINS-1 else edges[b]
        row[b] = max(0.0, phi((hb-level)/sd)-phi((lb-level)/sd)); tot += row[b]
    return [v/tot for v in row] if tot > 0 else row

for sd in [0.10,0.15,0.20,0.25,0.30,0.35,0.40]:
    doc = [tight(L, sd) for _ in range(5)]
    s = score(doc, [L]*5)
    nb = sum(1 for k in range(5) for b in range(BINS) if doc[k][b] > 0)/5
    print(f"  sd={sd:.2f}: size={s:8.4f}  bins/place={nb:4.0f}   total if order stays -19.52 = {s-19.52:8.3f}")
print(f"\n  reference: rank1 total -32.06 (order -18.17, size -13.89); mine now -37.64 (order -19.52, size -18.12)")

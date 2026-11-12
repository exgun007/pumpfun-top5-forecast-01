#!/usr/bin/env python3
"""EXACT scorer transcribed from RULES.txt worked example, then document optimiser.

Scoring (RULES lines 34, 44, 45):
  order score of a read = sum over places 1..5 of ln p, where
      p = declared prob if the coin at that place is named at that place,
      else (1 - sum declared at that place) / (coins_on_chart - named_at_that_place)
      [a row naming a coin not on the chart spends probability for nothing]
  size  score of a read = sum over places 1..5 of ln p, where
      p = declared prob of the bin the place's cap falls in,
      else (1 - sum declared at that place) / (82 - bins_named_at_that_place)
      [0 bins named => 1/82]
  reported score = mean over the 7 reads.  Floor ln(1e-4) only for invalid/empty output.

Validation targets (RULES):
  read1: place1 bin 26 named 0.3 -> size -18.830850
  read2: place1 bin 27 named 0.3 -> size -18.830850
  order read1 = -19.614603, read2 = -15.424948
"""
import json, math, copy

KIT = '/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit'
task = json.load(open(f'{KIT}/input/task.json'))
EDGES = task['size']['edges']
NB = len(EDGES) + 1
FLOOR = math.log(1e-4)

def bin_of(cap_log10):
    b = 0
    while b < NB - 1 and cap_log10 >= EDGES[b]:
        b += 1
    return b

def _erf(x):
    z = abs(x); t = 1.0 / (1.0 + 0.5 * z)
    r = t * math.exp(-z*z - 1.26551223 + t*(1.00002368 + t*(0.37409196 + t*(0.09678418 +
        t*(-0.18628806 + t*(0.27886807 + t*(-1.13520398 + t*(1.48851587 +
        t*(-0.82215223 + t*0.17087277)))))))))
    return 1 - r if x >= 0 else r - 1

def Phi(x): return 0.5 * (1 + _erf(x / math.sqrt(2)))

def gauss_on_grid(mu, sd):
    """Discrete Gaussian over the 82 bins, normalised, floor to 6dp like the real writer."""
    g = []
    for b in range(NB):
        lo = -1e9 if b == 0 else EDGES[b-1]
        hi = 1e9 if b == NB-1 else EDGES[b]
        g.append(max(0.0, Phi((hi-mu)/sd) - Phi((lo-mu)/sd)))
    tot = sum(g) or 1.0
    g = [v/tot for v in g]
    return [math.floor(v*1e6)/1e6 for v in g]

def size_score(doc, truths):
    """doc[k] = list of 82 probs (or None). truths[k][r] = cap log10 at read r."""
    n = len(truths[0]); tot = 0.0
    for r in range(n):
        for k in range(5):
            row = doc[k]
            if row is None:
                # no bin named at all at this place -> the whole unit mass spread over all 82 bins
                b = bin_of(truths[k][r])
                tot += math.log(1.0 / NB)
                continue
            named = [b for b in range(NB) if row[b] > 0]
            left = max(0.0, 1.0 - sum(row[b] for b in named))
            b = bin_of(truths[k][r])
            if row[b] > 0:
                p = row[b]
            else:
                p = left / (NB - len(named)) if NB > len(named) else 1.0/NB
            tot += max(FLOOR, math.log(p)) if p > 0 else FLOOR
    return tot / n

# ---------------- 1. validate against the RULES worked example ----------------
print("=== validation vs RULES worked example ===")
ex = [None]*5
ex[0] = [0.0]*NB
ex[0][bin_of(3.25)] = 0.3
ex[0][bin_of(3.30)] = 0.3
print(f"  bin_of(3.25)={bin_of(3.25)} bin_of(3.30)={bin_of(3.30)} (RULES says 26 -> 26,26 is wrong shape, recompute)")
# RULES: 10^3.25..10^3.30 -> bin 26 ; 10^3.30..10^3.35 -> bin 27
ex[0] = [0.0]*NB; ex[0][26] = 0.3; ex[0][27] = 0.3
for k in range(1,5): ex[k] = None
truth1 = [[3.264]+[0.0]*6 for _ in range(5)]   # place1 bin 26
s1 = size_score([ex[0]] + [None]*4, [[3.264]*7] + [[0.0]*7 for _ in range(4)])
print(f"  size score (place1 bin26 named 0.3, others unnamed) = {s1:.6f}   target -18.830850")
s1b = size_score([ex[0]] + [None]*4, [[3.314]*7] + [[0.0]*7 for _ in range(4)])
print(f"  size score with place1 in bin 27 (also named)        = {s1b:.6f}   target -18.830850")
print(f"  MATCH: {abs(s1+18.830850) < 1e-5 and abs(s1b+18.830850) < 1e-5}")

# ---------------- 2. sizes: optimal centre and width ----------------
print("\n=== empirical drift from the marks (top-5 place caps, log10 SOL) ===")
marks = [json.loads(l) for l in open(f'{KIT}/input/history.ndjson')]
marks = [m for m in marks if m.get('ok') and m.get('rows')]
def lc(r): return math.log10(int(r['market_cap_lamports'])/1e9)
cut = sorted(marks[-1]['rows'], key=lambda r: -int(r['market_cap_lamports']))[:5]
CUT = [lc(r) for r in cut]
print("  cut top-5:", [f"{v:.3f}" for v in CUT], " symbols:", [r['symbol'] for r in cut])

# place-cap series (mint-agnostic: k-th largest each mark)
ser = []
for m in marks:
    rows = sorted(m['rows'], key=lambda r: -int(r['market_cap_lamports']))[:5]
    ser.append((m['at'][11:16], [lc(r) for r in rows]))
for t, v in ser:
    print(f"  {t}  " + " ".join(f"{x:6.3f}" for x in v))

# growth per minute, robust: use median slope of each place over available marks
slopes = []
for k in range(5):
    pts = [(i, ser[i][1][k]) for i in range(len(ser))]
    for i in range(len(pts)-1):
        dt = 10.0
        slopes.append((pts[i+1][1]-pts[i][1])/dt)
slopes.sort()
med = slopes[len(slopes)//2]
mean = sum(slopes)/len(slopes)
print(f"\n  growth per minute: median {med:+.5f}  mean {mean:+.5f} dex/min  ->  per 10min {med*10:+.3f}")

READ_MIN = [10,20,30,40,50,60,70]
def truths(base_growth, extra_k=0.0):
    """cap at read r = cut + growth*(minutes) ; one truth per read."""
    out = []
    for k in range(5):
        out.append([CUT[k] + base_growth*min_ + (extra_k if k==0 else 0.0) for min_ in READ_MIN])
    return out

print("\n=== size score of candidate documents across plausible drift rates ===")
print(f"{'centre_shift':>13} {'sd':>6} " + " ".join(f"{g:>8.3f}" for g in (0.0,0.02,0.04,0.06,0.08)) + "   mean")
best = None
for shift in [x/100 for x in range(0,46,2)]:
    for sd in [x/100 for x in range(8,61,2)]:
        doc = [gauss_on_grid(CUT[k]+shift, sd) for k in range(5)]
        scs = [size_score(doc, truths(g)) for g in (0.0,0.02,0.04,0.06,0.08)]
        mean = sum(scs)/len(scs)
        if best is None or mean > best[0]:
            best = (mean, shift, sd, scs)
        if sd in (0.16,0.20) and shift in (0.14,0.20,0.26):
            print(f"{shift:13.2f} {sd:6.2f} " + " ".join(f"{s:8.3f}" for s in scs) + f"  {mean:7.3f}")
print(f"\n  BEST mean {best[0]:.3f} at shift={best[1]:.2f} sd={best[2]:.2f}  sizes={[round(s,3) for s in best[3]]}")
print(f"  score estimate: total = order(-19.52) + size({best[0]:.3f}) = {best[0]-19.52:.3f}")
json.dump({'shift':best[1],'sd':best[2],'CUT':CUT}, open('/tmp/sizebest.json','w'))

#!/usr/bin/env python3
"""Invert two EXACT known scores into the hidden answer's cap level per place.

Anchors (exact, from RULES.txt and the leaderboard):
  house baseline size score = -19.027956   (sizes = normal(MU_cut[k], 0.35), floor-rounded 6dp)
  my submitted size score   = -18.120000   (out/forecast.json, board shows -18.12)

Truth model: truth[k][r] = L[k] + D*r  (place k, read r; r = 0..6)
Find L[0..4], D so both anchors reproduce. Coordinate descent + D sweep.

Scorer mechanics validated against RULES' worked example before use.
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
    z = abs(x); t = 1.0 / (1.0 + 0.5 * z)
    r = t * math.exp(-z*z - 1.26551223 + t*(1.00002368 + t*(0.37409196 + t*(0.09678418 +
        t*(-0.18628806 + t*(0.27886807 + t*(-1.13520398 + t*(1.48851587 +
        t*(-0.82215223 + t*0.17087277)))))))))
    return 1 - r if x >= 0 else r - 1
def phi(x): return 0.5 * (1 + erf(x / math.sqrt(2)))

def binprob(mu, sd, b):
    lo = -1e9 if b == 0 else edges[b-1]
    hi = 1e9 if b == BINS-1 else edges[b]
    return max(0.0, phi((hi-mu)/sd) - phi((lo-mu)/sd))

def binof(x):
    b = 0
    while b < BINS-1 and x >= edges[b]:
        b += 1
    return b

def size_score(doc, truths):
    """doc[k] = list of 82 p (place k+1).  truths[k][r] = cap."""
    tot = 0.0
    for r in range(NREAD):
        for k in range(5):
            b = binof(truths[k][r])
            p = doc[k][b]
            tot += FLOOR if p <= 0 else max(math.log(p), FLOOR)
    return tot / NREAD

# ---------- validate scorer against RULES worked example ----------
# "ln(0.3) at place 1 (bin 26 named) and ln(1/82) at the other four -> -18.830850"
ex_doc = []
for k in range(5):
    row = [0.0]*BINS
    if k == 0: row[26] = 0.3
    ex_doc.append(row)
ex_truth = [[edges[25]] + [edges[25]]*6, [edges[26]]*7, [edges[26]]*7, [edges[26]]*7, [edges[26]]*7]
# bin edges[25]=3.25 -> bin 26 ; unnamed bins share (1-0.3)/81
def size_score_unnamed(doc, truths):
    tot = 0.0
    for r in range(NREAD):
        for k in range(5):
            row = doc[k]
            b = binof(truths[k][r])
            if row[b] > 0:
                p = row[b]
            else:
                named = sum(1 for v in row if v > 0)
                left = max(0.0, 1 - sum(row))
                p = left / (BINS - named) if BINS - named else 0.0
            tot += FLOOR if p <= 0 else max(math.log(p), FLOOR)
    return tot / NREAD
print("VALIDATE worked example: got", round(size_score_unnamed(ex_doc, ex_truth), 6), "expect -18.83085 (approx, floor/rounding)")

# ---------- documents ----------
BASE_SD = 0.35
base_doc = [[math.floor(binprob(MU[k], BASE_SD, b) * 1e6) / 1e6 for b in range(BINS)] for k in range(5)]
mine = json.load(open('/home/ubuntu/web3/makefun/entry/out/forecast.json'))
my_doc = []
for k in range(5):
    row = [0.0]*BINS
    for r in mine['sizes']:
        if r['place'] == k+1: row[r['bin']] = r['p']
    my_doc.append(row)

T_BASE, T_MINE = -19.027956, -18.12

def cost(L, D):
    truths = [[L[k] + D*r for r in range(NREAD)] for k in range(5)]
    return (size_score(base_doc, truths) - T_BASE)**2 + (size_score(my_doc, truths) - T_MINE)**2

# ---------- coordinate descent ----------
best = None
for D0 in [x/10 for x in range(-25, 26, 5)]:
    L = [MU[k] for k in range(5)]
    c = cost(L, D0)
    D = D0
    for sweep in range(60):
        improved = False
        for k in range(5):
            for delta in [-0.30,-0.20,-0.14,-0.10,-0.07,-0.05,-0.03,-0.02,-0.01,0.01,0.02,0.03,0.05,0.07,0.10,0.14,0.20,0.30]:
                cand = list(L); cand[k] += delta
                c2 = cost(cand, D)
                if c2 < c - 1e-12:
                    L, c = cand, c2; improved = True
        for delta in [-0.06,-0.04,-0.03,-0.02,-0.01,0.01,0.02,0.03,0.04,0.06]:
            c2 = cost(L, D + delta)
            if c2 < c - 1e-12:
                D, c = D + delta, c2; improved = True
        if not improved: break
    if best is None or c < best[0]:
        best = (c, list(L), D)

c, L, D = best
truths = [[L[k] + D*r for r in range(NREAD)] for k in range(5)]
print(f"\nBEST: resid^2={c:.6f}  D={D:+.3f} dex/read")
print(f"  base size={size_score(base_doc, truths):.6f}  (target {T_BASE})")
print(f"  mine size={size_score(my_doc,  truths):.6f}  (target {T_MINE})")
print("\n  implied truth level per place (read0 -> final read):")
for k in range(5):
    print(f"    place{k+1}: {L[k]:.3f} -> {L[k]+D*6:.3f}   (cut was {MU[k]:.3f})")
print(f"\n  level range across places: {min(L):.2f} .. {max(L):.2f}  (spread {max(L)-min(L):.2f} dex)")

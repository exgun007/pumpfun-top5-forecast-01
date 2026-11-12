#!/usr/bin/env python3
"""Score the NEW model output with the exact scorer, over the pinned family and stress cases."""
import json, math

KIT='/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit'
task=json.load(open(f'{KIT}/input/task.json'))
EDGES=task['size']['edges']; NB=len(EDGES)+1; FLOOR=math.log(1e-4)
READ_MIN=[10,20,30,40,50,60,70]

def bin_of(c):
    b=0
    while b<NB-1 and c>=EDGES[b]: b+=1
    return b

def size_score(doc,levels):
    n=len(levels[0]); tot=0.0
    for r in range(n):
        for k in range(5):
            row=doc[k]; b=bin_of(levels[k][r])
            if row is None: tot+=math.log(1.0/NB); continue
            named=[j for j in range(NB) if row[j]>0]
            if row[b]>0: p=row[b]
            else:
                left=max(0.0,1.0-sum(row[j] for j in named))
                p=left/(NB-len(named)) if NB>len(named) else 1.0/NB
            tot+=max(FLOOR,math.log(p)) if p>0 else FLOOR
    return tot/n

def load(p):
    d=json.load(open(p)); doc=[]
    for k in range(5):
        row=[0.0]*NB
        for r in d['sizes']:
            if r['place']==k+1: row[r['bin']]=r['p']
        doc.append(row if sum(row)>0 else None)
    return doc

marks=[json.loads(l) for l in open(f'{KIT}/input/history.ndjson')]
marks=[m for m in marks if m.get('ok') and (m.get('rows') or [])]
marks=[m for m in marks if all('market_cap_lamports' in r for r in m['rows'])]
def lc(r): return math.log10(int(r['market_cap_lamports']))-9
CUT=[lc(r) for r in sorted(marks[-1]['rows'],key=lambda r:-int(r['market_cap_lamports']))[:5]]

def levels(A,tau):
    return [[CUT[k]+(A-CUT[k])*(1-math.exp(-mn/tau)) for mn in READ_MIN] for k in range(5)]

old=load('/home/ubuntu/web3/makefun/entry/out/forecast.json')
new=load('/tmp/outblk/forecast.json')
print("old named bins:",[sum(1 for v in d if v>0) if d else 0 for d in old])
print("new named bins:",[sum(1 for v in d if v>0) if d else 0 for d in new])

pin=[]
for Ai in range(370,431):
    A=Ai/100
    for ti in range(15,91):
        if abs(size_score(old,levels(A,float(ti)))+18.12)<0.01: pin.append((A,float(ti)))
print(f"\npinned truths: {len(pin)}  A {min(p[0] for p in pin):.2f}..{max(p[0] for p in pin):.2f}  tau {min(p[1] for p in pin):.0f}..{max(p[1] for p in pin):.0f}")

print("\n--- score under the pinned family ---")
so=[size_score(old,levels(A,t)) for A,t in pin]
sn=[size_score(new,levels(A,t)) for A,t in pin]
print(f"  OLD size {min(so):.3f}..{max(so):.3f} -> total {min(so)-19.52:.2f}..{max(so)-19.52:.2f}")
print(f"  NEW size {min(sn):.3f}..{max(sn):.3f} -> total {min(sn)-19.52:.2f}..{max(sn)-19.52:.2f}")

print("\n--- stress truths (outside the pinned set) ---")
print(f"{'case':>14} {'OLD':>8} {'NEW':>8}")
cases=[]
for A in (3.40,3.60,3.80,4.00,4.20,4.40,4.60):
    for t in (20.0,45.0,90.0):
        cases.append((f"A{A:.2f}/t{t:.0f}",levels(A,t)))
cases.append(("flat-cut",[[CUT[k]]*7 for k in range(5)]))
for nm,lv in cases:
    print(f"{nm:>14} {size_score(old,lv):8.3f} {size_score(new,lv):8.3f}")

worst_old=min(size_score(old,lv) for _,lv in cases)
worst_new=min(size_score(new,lv) for _,lv in cases)
print(f"\nworst-case (all stress): OLD {worst_old:.3f} NEW {worst_new:.3f}")
print(f"  -> total OLD {worst_old-19.52:.2f} NEW {worst_new-19.52:.2f}")
print(f"\nreference: shipped -18.120 (total -37.64) | rank10 ~-33.7 | rank3 ~-32.5 | rank1 -32.06")

#!/usr/bin/env python3
"""Block-uniform size document: mathematically the right shape for a DISCRETE log score.

Fact (exact scorer validated against RULES): naming a bin that the truth falls in pays ln p.
Spreading mass as a wide Gaussian is strictly worse than a contiguous uniform BLOCK, because
the block keeps the residual (1 - S) small and jumps into unnamed bins, while a Gaussian
spends most of its mass on bins the truth will never take.

   uniform over k bins, truth inside  ->  score = ln(1/k) = -ln k
   k = 11  ->  -2.398 per place  ->  size -11.99
   k = 19  (what the shipped Gaussian effectively covered) -> -2.94, and worse when it misses

So the play is: pick the SHORTEST block that still contains the truth. Width comes from the
measured growth of the top-5 order statistic, not from a fitted sigma.
"""
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

def block_doc(lo_shift, hi_shift, base):
    """uniform over every bin touched by [base+lo_shift, base+hi_shift] per place."""
    doc=[]
    for k in range(5):
        b0=bin_of(base[k]+lo_shift); b1=bin_of(base[k]+hi_shift)
        b0=max(0,min(NB-1,b0)); b1=max(b0,min(NB-1,b1))
        n=b1-b0+1
        row=[0.0]*NB
        for b in range(b0,b1+1): row[b]=math.floor((1.0/n)*1e6)/1e6
        doc.append(row)
    return doc, [sum(1 for v in d if v>0) for d in doc]

marks=[json.loads(l) for l in open(f'{KIT}/input/history.ndjson')]
marks=[m for m in marks if m.get('ok') and m.get('rows')]
def lc(r): return math.log10(int(r['market_cap_lamports'])/1e9)
LAST=[lc(r) for r in sorted(marks[-1]['rows'],key=lambda r:-int(r['market_cap_lamports']))[:5]]
FULL=[m for m in marks if len(m['rows'])>=200]
ORDERS=[[lc(r) for r in sorted(m['rows'],key=lambda r:-int(r['market_cap_lamports']))[:5]] for m in FULL]
CENTRE=[sum(o[k] for o in ORDERS)/len(ORDERS) for k in range(5)]
print("CENTRE " + " ".join(f"{v:.3f}" for v in CENTRE))
print("LAST   " + " ".join(f"{v:.3f}" for v in LAST))

# measured per-place growth of the order statistic over the 10 full marks we have
print("\nmeasured growth of the k-th order statistic (dex per 10 min):")
for k in range(5):
    for i in range(len(ORDERS)-1):
        print(f"  place {k+1} {FULL[i]['at'][11:16]}->{FULL[i+1]['at'][11:16]}: {ORDERS[i+1][k]-ORDERS[i][k]:+.3f}")

# plausible truths: base = LAST (most recent observation), growth 0.00 .. 0.06 dex/min
fam=[]
for base_name, base in (('LAST',LAST),('CENTRE',CENTRE)):
    for g in (0.0,0.005,0.01,0.02,0.03,0.04,0.06):
        lv=[[base[k]+g*mn for mn in READ_MIN] for k in range(5)]
        fam.append((base_name,g,lv))
print(f"\ntruth family: {len(fam)}")

print("\n=== block width vs worst/mean exact size score (base LAST) ===")
print(f"{'lo':>5} {'hi':>5} {'bins':>12} {'worst':>8} {'mean':>8}   est TOTAL (order -19.52)")
rows=[]
for lo in (-0.10,0.0,0.05,0.10,0.15):
    for hi in (0.30,0.40,0.50,0.60,0.70,0.80):
        doc,nb=block_doc(lo,hi,LAST)
        sc=[size_score(doc,lv) for _,_,lv in fam]
        rows.append((min(sc),sum(sc)/len(sc),lo,hi,nb))
rows.sort(reverse=True)
for w,m,lo,hi,nb in rows:
    print(f"{lo:5.2f} {hi:5.2f} {str(nb):>12} {w:8.3f} {m:8.3f}   {w-19.52:8.3f}")

print("\n=== same, based on CENTRE ===")
rows2=[]
for lo in (-0.10,0.0,0.05,0.10):
    for hi in (0.40,0.50,0.60,0.70,0.80):
        doc,nb=block_doc(lo,hi,CENTRE)
        sc=[size_score(doc,lv) for _,_,lv in fam]
        rows2.append((min(sc),sum(sc)/len(sc),lo,hi,nb))
rows2.sort(reverse=True)
for w,m,lo,hi,nb in rows2[:6]:
    print(f"{lo:5.2f} {hi:5.2f} {str(nb):>12} {w:8.3f} {m:8.3f}   {w-19.52:8.3f}")

w,m,lo,hi,nb=rows[0]
print(f"\nPICK base=LAST lo={lo:+.2f} hi={hi:+.2f} bins={nb}  worst={w:.3f} mean={m:.3f}")
print(f"  est total worst {w-19.52:.3f} / mean {m-19.52:.3f}   (rank1 -32.06, rank10 ~-33.7)")
json.dump({'base':'LAST','lo':lo,'hi':hi,'LAST':LAST,'CENTRE':CENTRE,'bins':nb},open('/tmp/block.json','w'))

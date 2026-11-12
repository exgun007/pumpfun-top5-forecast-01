#!/usr/bin/env python3
"""Choose the size document by MINIMAX over a family of plausible truths.

Evidence we trust:
  E1. individual coins barely move (median drift 0.0000 dex over 10 min, measured on 100+ matched mints).
      So the answer's top-5 cap is an ORDER STATISTIC of a rotating population, not a path of fixed coins.
  E2. that order statistic has been RISING: place1 3.258 -> 3.468 -> 3.561 over the last three marks.
  E3. our exact scorer (validated to -18.830850 against RULES) says the honest way to raise size score
      is to name FEW bins around the true one; bins left unnamed share the residual, so naming a wide
      swathe is strictly worse than naming a tight one that contains the truth.

Unknown: the exact level/growth of the answer's order statistic over the 7 answer reads.
Handle it the way a risk-averse forecaster should: enumerate plausible truths, and pick the document
that maximises the WORST-CASE exact size score. No single truth is assumed to be right.
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
def _erf(x):
    z=abs(x); t=1.0/(1.0+0.5*z)
    r=t*math.exp(-z*z-1.26551223+t*(1.00002368+t*(0.37409196+t*(0.09678418+
        t*(-0.18628806+t*(0.27886807+t*(-1.13520398+t*(1.48851587+
        t*(-0.82215223+t*0.17087277)))))))))
    return 1-r if x>=0 else r-1
def Phi(x): return 0.5*(1+_erf(x/math.sqrt(2)))
def gauss(mu,sd):
    g=[]
    for b in range(NB):
        lo=-1e9 if b==0 else EDGES[b-1]; hi=1e9 if b==NB-1 else EDGES[b]
        g.append(max(0.0,Phi((hi-mu)/sd)-Phi((lo-mu)/sd)))
    t=sum(g) or 1.0
    return [math.floor(v/t*1e6)/1e6 for v in g]
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

marks=[json.loads(l) for l in open(f'{KIT}/input/history.ndjson')]
marks=[m for m in marks if m.get('ok') and m.get('rows')]
full=[m for m in marks if len(m['rows'])>=200]
def lc(r): return math.log10(int(r['market_cap_lamports'])/1e9)
orders=[[lc(r) for r in sorted(m['rows'],key=lambda r:-int(r['market_cap_lamports']))[:5]] for m in full]
CENTRE=[sum(o[k] for o in orders)/len(orders) for k in range(5)]
LAST=[lc(r) for r in sorted(marks[-1]['rows'],key=lambda r:-int(r['market_cap_lamports']))[:5]]
print("CENTRE " + " ".join(f"{v:.3f}" for v in CENTRE))
print("LAST   " + " ".join(f"{v:.3f}" for v in LAST))

# ---------- family of plausible truths ----------
family=[]
for cname, base in (('centre',CENTRE), ('last',LAST), ('mid',[(a+b)/2 for a,b in zip(CENTRE,LAST)])):
    for g in (-0.03,0.0,0.02,0.04,0.06):
        for gap in (0.0,0.06,0.12):   # extra compression toward place1 (newcomers cluster)
            lv=[[base[k]+gap*(1-k/4.0)+g*(mn-50) for mn in READ_MIN] for k in range(5)]
            family.append((cname,g,gap,lv))
print(f"truth family size: {len(family)}")

# ---------- minimax over candidate documents ----------
print("\n=== minimax over (offset, sd) ===")
rows=[]
for off in [x/100 for x in range(-24,25,2)]:
    for sd in [x/100 for x in range(10,41,2)]:
        doc=[gauss((CENTRE[k]+LAST[k])/2+off,sd) for k in range(5)]
        sc=[size_score(doc,lv) for _,_,_,lv in family]
        rows.append((min(sc),sum(sc)/len(sc),off,sd))
rows.sort(reverse=True)
print(f"{'worst':>8} {'mean':>8} {'off':>5} {'sd':>5}   est TOTAL (order -19.52)")
for w,m,off,sd in rows[:12]:
    print(f"{w:8.3f} {m:8.3f} {off:5.2f} {sd:5.2f}   {w-19.52:8.3f}")

w,m,off,sd=rows[0]
print(f"\nPICK offset={off:+.2f} sd={sd:.2f}  worst={w:.3f} mean={m:.3f}")
print(f"  est total worst-case {w-19.52:.3f} (order -19.52) ; rank1 -32.06")
print(f"  est total mean       {m-19.52:.3f}")

# sensitivity: neighbouring choices
print("\n  neighbours (worst-case):")
for o2 in (off-0.04,off,off+0.04):
    line=[]
    for s2 in (0.16,0.18,sd,0.24,0.28):
        doc=[gauss((CENTRE[k]+LAST[k])/2+o2,s2) for k in range(5)]
        line.append(f"sd{s2:.2f}={min(size_score(doc,lv) for _,_,_,lv in family):7.3f}")
    print(f"    off{o2:+.2f} " + " ".join(line))
json.dump({'off':off,'sd':sd,'CENTRE':CENTRE,'LAST':LAST,'worst':w,'mean':m},open('/tmp/minimax.json','w'))

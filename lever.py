#!/usr/bin/env python3
"""Measure the p-0 lever on an EXACT anchor: the last practice read's top-5 mints are named in RULES.

Order rule (RULES 39/46): a coin you do not name at place k takes  unnamed_k / (coins on the chart you did
not name at place k).  Writing p=0 rows for coins you are sure will not hold takes them OUT of that
divisor, up to 100 rows per place.  So naming junk at 0 raises every unnamed coin's share.

We can score the last read exactly in the order part, because we know which five coins hold it.
"""
import json, math
KIT='/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit'
t=json.load(open(f'{KIT}/input/task.json'))
marks=[json.loads(l) for l in open(f'{KIT}/input/history.ndjson')]
marks=[m for m in marks if m.get('ok') and len(m.get('rows') or [])>=200]
cut=marks[-1]
def lc(r): return math.log10(int(r['market_cap_lamports'])/1e9)
ranked=sorted(cut['rows'], key=lambda r:-int(r['market_cap_lamports']))
HIST={r['mint'] for r in ranked}

ANS=['5qaP7oKUqKffwwo5DaEqDoTtsBLMpdbQTxEkCDaTpump',   # Max
     '4Dgjitjn8br3LcdcBnkc9tYJ8d1cnCCJd2nsVgzZpump',   # MIHAO VI
     'BuaseKYxFH5Bcz6uoTU2JiX32hRGsGfGLTgamoWpump',    # Google
     'HzwVr7KjPhUriHK9MrJbFzbTDTPwUXGrL2Ah2wVhpump',   # NIHAONOON
     'FjFVmDDM3w7qVLS9uxLkXnDM4qCGsqXSow6d32phpump']   # HAMSTER

print("=== which of the five answer mints are in our history? ===")
for i,m in enumerate(ANS,1):
    pos=[j for j,r in enumerate(ranked) if r['mint']==m]
    print(f"  place{i} {m[:10]}..  in_history={'YES rank '+str(pos[0]+1) if pos else 'NO (newcomer, unnamed only)'}")

# our forecast's probabilities
F=json.load(open('/home/ubuntu/web3/makefun/entry/out/forecast.json'))
prob=F['probabilities']
byp={}
for row in prob: byp.setdefault(row['place'],{})[row['mint']]=row['p']
print("\n=== our forecast at each place: named rows and their sum ===")
for k in range(1,6):
    d=byp.get(k,{})
    print(f"  place{k}: rows={len(d):3d} sum_p={sum(d.values()):.6f} unnamed={1-sum(d.values()):.6f}")
    for m,p in sorted(d.items(), key=lambda x:-x[1])[:3]:
        tag='  <-- ANSWER' if m in ANS else ''
        print(f"        {m[:10]}.. p={p:.6f}{tag}")

# chart size: the read's chart is 100 coins. Our history has more; the scorer sees only 100 largest
NCHART=100
print("\n=== order score at the LAST read, exact ===")
def order_score(named_at_place, ans_place, named_zero):
    """named_at_place: dict mint->p (p>0). named_zero: set of mints written at p=0. ans_place: mint holding place."""
    tot=0.0
    for k in range(1,6):
        d=named_at_place.get(k,{})
        z=named_zero.get(k,set())
        S=sum(d.values())
        unnamed=1.0-S
        n_not_named=NCHART-len(d)-len(z)
        p=None
        if ans_place[k] in d: p=d[ans_place[k]]
        else:
            if n_not_named<=0: n_not_named=1
            p=unnamed/n_not_named
        tot+=math.log(max(p,1e-4))
    return tot

ans_place={i+1:ANS[i] for i in range(5)}

base=order_score(byp, ans_place, {})
print(f"  current forecast                     : {base:.6f}")

# variant: write p=0 rows for history coins ranked deeper than a cutoff
for cut_rank in (20,40,60,80,100):
    nz={k:set() for k in range(1,6)}
    for r in ranked[cut_rank-1:]:
        m=r['mint']
        if m in ANS: continue
        for k in range(1,6):
            if m not in byp.get(k,{}): nz[k].add(m)
    s=order_score(byp, ans_place, nz)
    divs=[NCHART-len(byp.get(k,{}))-len(nz[k]) for k in range(1,6)]
    print(f"  + p0 rows for rank>{cut_rank:3d}            : {s:.6f}  (delta {s-base:+.4f})  divisor per place {divs}")

# how many rows total would we emit? cap is 100 rows per place
print("\n=== row budget check (a place may carry at most 100 rows) ===")
for cut_rank in (20,40,60,80,100):
    nz={k:0 for k in range(1,6)}
    for r in ranked[cut_rank-1:]:
        if r['mint'] in ANS: continue
        for k in range(1,6):
            if r['mint'] not in byp.get(k,{}): nz[k]+=1
    print(f"  rank>{cut_rank:3d}: rows per place = {[len(byp.get(k,{}))+nz[k] for k in range(1,6)]}")

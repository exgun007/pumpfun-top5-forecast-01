#!/usr/bin/env python3
"""Final size document: per-place block width from the MEASURED growth of the k-th order statistic.

Correction to the previous sweep: growth was in dex/10min but multiplied by minutes, i.e. 10x too
large, which produced absurd ranges and drove every candidate into the floor. Fix the scale, anchor
on the newest full mark (LAST), and let each place have its own measured growth rate.

Why a block and not a Gaussian: the score is a discrete log score on 82 bins and unnamed bins share
the residual. Uniform over a block of k bins containing the truth pays exactly ln(1/k) = -ln k with
no variance from where inside the block the truth lands. A Gaussian of the same coverage pays less
because its mass is concentrated on bins the truth usually misses.
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

marks=[json.loads(l) for l in open(f'{KIT}/input/history.ndjson')]
marks=[m for m in marks if m.get('ok') and m.get('rows')]
def lc(r): return math.log10(int(r['market_cap_lamports'])/1e9)
full=[m for m in marks if len(m['rows'])>=200]
ORDERS=[[lc(r) for r in sorted(m['rows'],key=lambda r:-int(r['market_cap_lamports']))[:5]] for m in full]
print("full marks:", [m['at'][11:16] for m in full])
for t,o in zip([m['at'][11:16] for m in full],ORDERS):
    print(f"  {t}  " + " ".join(f"{v:.3f}" for v in o))

LAST=ORDERS[-1]
# per-place growth over the last three full marks, dex per minute
G=[]
for k in range(5):
    d=(ORDERS[-1][k]-ORDERS[0][k])/((len(ORDERS)-1)*10.0)
    G.append(d)
print("\nper-place growth (dex/min, last 3 full marks): " + " ".join(f"{g:+.5f}" for g in G))
print("  over 70 min: " + " ".join(f"{g*70:+.3f}" for g in G))

# truth family: scale the measured growth by a factor, plus a downward slack
fam=[]
for f in (0.0,0.5,0.8,1.0,1.3,1.6):
    for slack in (-0.10,-0.05,0.0):
        lv=[[LAST[k]+slack+G[k]*f*mn for mn in READ_MIN] for k in range(5)]
        fam.append((f,slack,lv))
print(f"truth family: {len(fam)}")

def block_doc(pad_lo, pad_hi_mult):
    doc=[]; nb=[]
    for k in range(5):
        lo=LAST[k]-pad_lo
        hi=LAST[k]+G[k]*pad_hi_mult*70+0.05
        b0=max(0,min(NB-1,bin_of(lo))); b1=max(b0,min(NB-1,bin_of(hi)))
        n=b1-b0+1
        row=[0.0]*NB
        for b in range(b0,b1+1): row[b]=math.floor((1.0/n)*1e6)/1e6
        doc.append(row); nb.append(n)
    return doc,nb

print("\n=== block choice: worst / mean exact size score ===")
print(f"{'padLo':>6} {'gMult':>6} {'bins':>18} {'worst':>8} {'mean':>8}   estTOTAL worst / mean")
rows=[]
for pl in (0.0,0.05,0.10,0.15,0.20):
    for gm in (0.8,1.0,1.2,1.4,1.6,1.8):
        doc,nb=block_doc(pl,gm)
        sc=[size_score(doc,lv) for _,_,lv in fam]
        rows.append((min(sc),sum(sc)/len(sc),pl,gm,nb))
rows.sort(reverse=True)
for w,m,pl,gm,nb in rows:
    print(f"{pl:6.2f} {gm:6.1f} {str(nb):>18} {w:8.3f} {m:8.3f}   {w-19.52:7.2f} / {m-19.52:7.2f}")

w,m,pl,gm,nb=rows[0]
print(f"\nPICK padLo={pl} gMult={gm} bins={nb}")
print(f"  worst {w:.3f} -> total {w-19.52:.2f} | mean {m:.3f} -> total {m-19.52:.2f}")
print(f"  (shipped -18.12 -> total -37.64 ; rank1 size -13.89 -> total -32.06 ; rank10 ~-33.7)")
json.dump({'padLo':pl,'gMult':gm,'G':G,'LAST':LAST,'bins':nb,'worst':w,'mean':m},open('/tmp/block2.json','w'))

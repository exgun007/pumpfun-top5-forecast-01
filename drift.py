#!/usr/bin/env python3
"""Empirical per-place drift from the 6 real marks, then extrapolate to the 7 answer reads.

No assumed family. For each place k we have 6 observations (20:30..20:50, every 10 min).
Fit growth as: level(t) = level(cut) + G*(1 - exp(-dt/tau)) with tau scanned, G free per
place, chosen by least squares against the 6 marks. Then read off the 7 read times.

If the marks are linear over the fit window, tau -> large and the extrapolation is linear
(slower). If they decelerate, tau is small and growth saturates. We also report a purely
linear extrapolation as the optimistic bound and a saturated one as the pessimistic bound,
then choose the document that does best across that spread.
"""
import json, math

KIT='/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit'
task=json.load(open(f'{KIT}/input/task.json'))
marks=[json.loads(l) for l in open(f'{KIT}/input/history.ndjson')]
marks=[m for m in marks if m.get('ok') and m.get('rows')]
def lc(r): return math.log10(int(r['market_cap_lamports'])/1e9)

# per-mark caps of the coins that are in the cut (top-5 tracked by mint)
cut=sorted(marks[-1]['rows'],key=lambda r:-int(r['market_cap_lamports']))
TOP=[r['mint'] for r in cut[:5]]
print("cut top-5:", [r['symbol'] for r in cut[:5]])
print(f"{'mark':>6} " + " ".join(f"p{k+1:>5}" for k in range(5)))
obs=[]
for m in marks:
    d={r['mint']:lc(r) for r in m['rows']}
    row=[d.get(mm, float('nan')) for mm in TOP]
    obs.append((m['at'][11:16], row))
    print(f"{m['at'][11:16]:>6} " + " ".join(f"{v:6.3f}" if v==v else "   nan" for v in row))

N=len(obs)
dt=[i*10.0 for i in range(N)]  # minutes from first mark
CUTMIN=50.0                    # cut is the last mark
readmin=[10.0,20.0,30.0,40.0,50.0,60.0,70.0]  # minutes after cut

def fit_place(k):
    y=[obs[i][1][k] for i in range(N)]
    if any(v!=v for v in y): return None
    base=y[-1]
    best=None
    for tau in [5,8,10,12,15,20,30,45,60,90,120,180,240,360,1e9]:
        # solve G by least squares on residual
        num=den=0.0
        for i in range(N):
            f=1-math.exp(-(CUTMIN-dt[i])/tau)
            r=(y[i]-base)
            num+=f*r; den+=f*f
        if den<1e-9: continue
        G=num/den
        sse=sum(((base+G*(1-math.exp(-(CUTMIN-dt[i])/tau)))-y[i])**2 for i in range(N))
        if best is None or sse<best[0]: best=(sse,G,tau)
    return best

print("\n=== per-place drift fit (minutes from cut are negative: -20..-0) ===")
fits=[]
for k in range(5):
    f=fit_place(k)
    if f is None: print(f"place {k+1}: nan"); continue
    sse,G,tau=f
    fits.append((G,tau))
    gr10=(G*(1-math.exp(-(CUTMIN-40)/tau))-G*(1-math.exp(-(CUTMIN-50)/tau)))
    print(f"place {k+1}: G={G:+.3f} dex  tau={tau:>7.1f} min  sse={sse:.5f}  (last-10min growth {gr10:+.3f} dex)")

print("\n=== extrapolated truth at the 7 reads ===")
for k in range(5):
    G,tau=fits[k]
    base=obs[-1][1][k]
    vals=[base+G*(1-math.exp(-r/tau)) for r in readmin]
    print(f"place {k+1}: " + " ".join(f"{v:.2f}" for v in vals))

json.dump({'fits':fits,'TOP':TOP}, open('/tmp/drift.json','w'))

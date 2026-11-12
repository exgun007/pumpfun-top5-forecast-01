#!/usr/bin/env python3
"""Honest drift measurement: match the SAME mint across consecutive marks."""
import json, math
KIT='/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit'
marks=[json.loads(l) for l in open(f'{KIT}/input/history.ndjson')]
marks=[m for m in marks if m.get('ok') and m.get('rows')]
def lc(r): return math.log10(int(r['market_cap_lamports'])/1e9)

print("per-mark row counts:", [len(m['rows']) for m in marks])
for i in range(len(marks)-1):
    a={r['mint']:lc(r) for r in marks[i]['rows']}
    b={r['mint']:lc(r) for r in marks[i+1]['rows']}
    common=set(a)&set(b)
    ds=[b[m]-a[m] for m in common]
    ds.sort()
    tag=f"{marks[i]['at'][11:16]}->{marks[i+1]['at'][11:16]}"
    if ds:
        med=ds[len(ds)//2]
        print(f"{tag}  common={len(common):3d}  median={med:+.4f}  mean={sum(ds)/len(ds):+.4f}  "
              f"p10={ds[max(0,len(ds)//10)]:+.3f} p90={ds[min(len(ds)-1,9*len(ds)//10)]:+.3f}  dex/10min")
    else:
        print(f"{tag}  common=0")

# full span drift, matched mints present at first AND last mark
a={r['mint']:lc(r) for r in marks[0]['rows']}
z={r['mint']:lc(r) for r in marks[-1]['rows']}
com=set(a)&set(z)
if com:
    ds=sorted(z[m]-a[m] for m in com)
    span=(len(marks)-1)*10
    print(f"\nfull span {span} min, {len(com)} mints matched: median {ds[len(ds)//2]:+.3f} dex  -> {(ds[len(ds)//2]/span)*10:+.4f}/10min")
    print(f"  p10 {ds[len(ds)//10]:+.3f}  p90 {ds[9*len(ds)//10]:+.3f}")

# top-5 by cap, same mint across all marks
cut=sorted(marks[-1]['rows'],key=lambda r:-int(r['market_cap_lamports']))[:5]
print("\ntop-5 at cut, their own cap history:")
for r in cut:
    m=r['mint']
    hist=[]
    for mk in marks:
        d={x['mint']:lc(x) for x in mk['rows']}
        hist.append(d.get(m))
    print(f"  {r['symbol']:12s} " + " ".join(f"{v:6.3f}" if v is not None else "   --" for v in hist))

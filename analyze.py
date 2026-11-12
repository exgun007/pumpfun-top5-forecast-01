#!/usr/bin/env python3
"""Measure what the marks actually say: cadence, per-place caps, drift per hour, newcomer stats."""
import json, math, statistics
KIT = '/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit'
marks = [json.loads(l) for l in open(f'{KIT}/input/history.ndjson')]
marks = [m for m in marks if m.get('ok') and m.get('rows')]
print(f"ok marks: {len(marks)}")

ts = [m['at'] for m in marks]
print("timestamps:", ts[0], "->", ts[-1])
from datetime import datetime
def ms(s): return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000
gaps = [ (ms(ts[i+1])-ms(ts[i]))/60000 for i in range(len(ts)-1) ]
print(f"gaps (min): {[round(g,2) for g in gaps]}  median={statistics.median(gaps):.3f}")

def lc(row): return math.log10(int(row['market_cap_lamports'])/1e9)
rows_per = [len(m['rows']) for m in marks]
print(f"rows per mark: {rows_per}")

print("\n=== place caps (log10 SOL) per mark ===")
print(f"{'mark':8s} " + " ".join(f"P{k:<7d}" for k in range(1,6)) + "  spread  topcap")
for i,m in enumerate(marks):
    r = sorted(m['rows'], key=lambda x: -int(x['market_cap_lamports']))
    caps = [lc(x) for x in r[:5]]
    print(f"{m['at'][11:19]} " + " ".join(f"{c:<8.3f}" for c in caps) + f"  {caps[0]-caps[4]:.3f}  {lc(r[0]):.3f}")

cut = marks[-1]
cutcaps = [lc(x) for x in sorted(cut['rows'], key=lambda x:-int(x['market_cap_lamports']))[:5]]
print(f"\ncut caps: {[round(c,3) for c in cutcaps]}")

print("\n=== per-place climb per 10-min mark (dx/mark) ===")
for k in range(5):
    seq = []
    for m in marks:
        r = sorted(m['rows'], key=lambda x:-int(x['market_cap_lamports']))
        seq.append(lc(r[k]))
    d = [seq[i+1]-seq[i] for i in range(len(seq)-1)]
    print(f" P{k+1}: {[round(x,3) for x in seq]}  mean dx/mark={statistics.mean(d):+.3f}  -> per hour={statistics.mean(d)*6:+.2f}")

print("\n=== newcomer arrivals ===")
seen=set(); new_stats=[]
for i in range(len(marks)):
    cur = {r['mint'] for r in marks[i]['rows']}
    fresh = cur-seen
    if i>0 and fresh:
        caps = sorted([lc(r) for r in marks[i]['rows'] if r['mint'] in fresh], reverse=True)
        new_stats.append((marks[i]['at'][11:19], len(fresh), caps[0], caps[len(caps)//4] if caps else None))
    seen |= cur
for s in new_stats: print(f"  {s[0]} n={s[1]:3d} top_new={s[2]:.3f} q75_new={s[3]}")

allc = [lc(r) for m in marks for r in m['rows']]
print(f"\nall caps: min={min(allc):.3f} max={max(allc):.3f} mean={statistics.mean(allc):.3f}")
top10 = sorted(allc, reverse=True)[:10]
print("top10 caps:", [round(x,2) for x in top10])

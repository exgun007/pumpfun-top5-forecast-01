#!/usr/bin/env python3
"""Validate: score the SUBMITTED forecast against the EXACT ground truth and compare to the official
-37.64 (order -19.52, size -18.12).

If this reproduces the official numbers, then the scorer transcription and the reconstructed answer are
both correct, and the document can be optimised with confidence instead of by feel.
"""
import json, math, subprocess

KIT='/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit'
task=json.load(open(f'{KIT}/input/task.json'))
E=task['size']['edges']; BINS=len(E)+1; NCHART=task['chart_size']
ans=json.load(open('/tmp/gt_answer.json'))

# the submitted forecast: pull it from the commit that produced -37.64
raw=subprocess.check_output(['git','-C','/home/ubuntu/web3/makefun/entry','show',
                             '74747eb:out/forecast.json'],text=True)
F=json.loads(raw)
prob=F['probabilities']; sizes=F['sizes']

# history mints (the only mints that can be scored)
mints=set()
for line in open(f'{KIT}/input/history.ndjson'):
    o=json.loads(line)
    if o.get('ok'):
        for r in o['rows']: mints.add(r['mint'])
print(f"history mints: {len(mints)}   prob rows: {len(prob)}   size rows: {len(sizes)}")

def order_score_read(r, ans_list):
    """ans_list: ordered list of dicts with 'mint' for places 1..len"""
    named={k:{} for k in range(1,6)}
    for row in prob:
        if row['mint'] in mints and row['p']>0:
            named[row['place']].setdefault(row['mint'],0.0)
            named[row['place']][row['mint']]+=row['p']
    tot=0.0
    for k in range(1,6):
        if k>len(ans_list): break
        truth=ans_list[k-1]['mint']
        d=named[k]
        S=sum(d.values()); unnamed=max(0.0,1.0-S)
        if truth in d:
            p=d[truth]
        else:
            nd=max(1,NCHART-len(d))
            p=unnamed/nd
        tot+=math.log(max(p,1e-4))
    return tot

def size_score_read(r, ans_list):
    sd={}
    for row in sizes:
        sd.setdefault(row['place'],{})[row['bin']]=row['p']
    tot=0.0
    for k in range(1,6):
        if k>len(ans_list): break
        truthbin=ans_list[k-1]['bin']
        d=sd.get(k,{})
        S=sum(d.values()); unnamed=max(0.0,1.0-S)
        if truthbin in d:
            p=d[truthbin]
        else:
            p=unnamed/(BINS-len(d)) if (BINS-len(d))>0 else 0.0
        tot+=math.log(max(p,1e-4))
    return tot

reads=sorted(ans.keys(), key=int)
o_tot=s_tot=0.0
print("\n=== per read against EXACT ground truth ===")
for r in reads:
    a=ans[r]
    o=order_score_read(r,a); s=size_score_read(r,a)
    o_tot+=o; s_tot+=s
    places=[f"{x['name']}(b{x['bin']})" for x in a]
    print(f"  {r}  order={o:8.4f}  size={s:8.4f}  truth: {','.join(places)}")

n=len(reads)
print(f"\nMEAN order = {o_tot/n:.6f}   (official -19.52)")
print(f"MEAN size  = {s_tot/n:.6f}   (official -18.12)")
print(f"MEAN total = {(o_tot+s_tot)/n:.6f}   (official -37.64)")

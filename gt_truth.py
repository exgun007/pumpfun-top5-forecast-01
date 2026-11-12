#!/usr/bin/env python3
"""EXACT ground truth, rebuilt with the correct epoch (1794430800 = 2026-11-11T21:00:00Z).

Uses the candles already cached in /tmp/gt_cache.json, so no further API calls are needed except
SOL/USD from Binance (also cached).
"""
import json, math, time, os

cache=json.load(open('/tmp/gt_cache.json'))

H0=1794430800                      # 2026-11-11T21:00:00Z  (verified against the candle timestamps)
READS=[H0+600*i for i in range(7)]
MINTS={
 'Max':'5qaP7oKUqKffwwo5DaEqDoTtsBLMpdbQTxEkCDaTpump',
 'MIHAO':'4Dgjitjn8br3LcdcBnkc9tYJ8d1cnCCJd2nsVgzZpump',
 'Google':'BuaseKYxFH5Bcz6uoTU2JiX32hRGsGfGLTgamoWpump',
 'NIHAONOON':'HzwVr7KjPhUriHK9MrJbFzbTDTPwUXGrL2Ah2wVhpump',
 'HAMSTER':'FjFVmDDM3w7qVLS9uxLkXnDM4qCGsqXSow6d32phpump',
}
BORN={'Max':H0+29,'MIHAO':H0-1821,'Google':H0-2305,'NIHAONOON':H0+2397,'HAMSTER':H0+3499}

# SOL/USD hourly. Binance klines were fetched with the wrong epoch, but SOL barely moves in an hour
# and we can pin it from the klines we did get: 20:00=156.77 21:00=156.08 22:00=156.68 23:00=154.63.
# Re-fetch with the correct epoch to be exact.
import urllib.request
def get(u,tries=4):
    for i in range(tries):
        try:
            req=urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(req,timeout=30) as f: return json.loads(f.read())
        except Exception as e:
            time.sleep(5)
            if i==tries-1: return {'__err__':str(e)}
    return {'__err__':'x'}

SOL={}
k=get('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=1h&startTime=%d&endTime=%d&limit=12'
      %((H0-3600)*1000,(H0+3*3600)*1000))
if isinstance(k,list):
    for row in k: SOL[int(row[0])//1000]=float(row[4])
    print("SOL/USD hourly:", {time.strftime('%H:%M',time.gmtime(t)):v for t,v in sorted(SOL.items())})
else:
    SOL={H0-3600:156.77, H0:156.08, H0+3600:156.68}
    print("SOL fallback:",{time.strftime('%H:%M',time.gmtime(t)):v for t,v in sorted(SOL.items())})

def sol_at(ts):
    hr=ts-(ts%3600)
    for c in (hr,hr-3600,hr+3600):
        if c in SOL: return SOL[c]
    return None

# price series per token, from cache
PX={}
for nm in MINTS:
    key=f'ohlcv_{nm}'
    if key not in cache: print(f"{nm}: NO CACHE"); continue
    rows=cache[key]['data']['attributes']['ohlcv_list']
    PX[nm]={int(r[0]):float(r[4]) for r in rows}
    print(f"{nm:10s} {len(PX[nm])} candles")

def price_at(nm,ts):
    for c in (ts, ts-60, ts+60, ts-120, ts+120, ts-300):
        if c in PX.get(nm,{}): return PX[nm][c]
    return None

# assemble exact answer
task=json.load(open('/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit/input/task.json'))
E=task['size']['edges']
def binOf(v):
    if v<E[0]: return 0
    if v>=E[-1]: return len(E)
    lo,hi=0,len(E)-1
    while lo<hi:
        m=(lo+hi)//2
        if E[m]<=v: lo=m+1
        else: hi=m
    return lo

print("\n=== EXACT GROUND TRUTH: top5 and size bin per read ===")
ans={}
for r in READS:
    row=[]
    for nm in MINTS:
        if r < BORN[nm]: continue
        p=price_at(nm,r)
        if p is None: continue
        s=sol_at(r)
        if not s: continue
        cap=p*1e9/s
        lg=math.log10(cap)
        row.append((lg,nm,cap))
    row.sort(reverse=True)
    top=row[:5]
    ans[r]=[{'mint':MINTS[nm],'name':nm,'log10':lg,'cap_sol':cap,'bin':binOf(lg)} for lg,nm,cap in top]
    print(f"  {time.strftime('%H:%M',time.gmtime(r))}Z")
    for i,e in enumerate(top,1):
        print(f"      place{i} {e[1]:10s} cap={e[2]:14,.0f} SOL  log10={e[0]:.3f}  bin={binOf(e[0])}")

json.dump({str(k):v for k,v in ans.items()},open('/tmp/gt_answer.json','w'),indent=1)
print("\nsaved /tmp/gt_answer.json")

# summary: which bins does each place take across the reads
print("\n=== bins per place across the 7 reads ===")
for k in range(5):
    bins=[]
    for r in READS:
        if len(ans[r])>k: bins.append(ans[r][k]['bin'])
    if bins: print(f"  place{k+1}: bins={bins}  range=[{min(bins)},{max(bins)}]  span={max(bins)-min(bins)+1}")

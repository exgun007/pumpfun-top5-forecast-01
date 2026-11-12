#!/usr/bin/env python3
"""EXACT ground truth for the practice answer reads.

Sources, chosen so each number is checkable:
  * token price history  : GeckoTerminal hourly/minute OHLCV of the token's deepest SOL pool (rate limited)
  * SOL/USD at each hour : Binance SOLUSDT 1h klines (no key, no limit trouble)
  * supply               : pump.fun is fixed at 10^9 tokens => 10^15 raw units (RULES line 13)

cap_SOL = (token_price_usd * 1e9) / SOL_usd      [token_price_usd is per whole token]
log10 cap -> bin via task.json edges.
"""
import json, math, time, urllib.request, urllib.error, os

CACHE='/tmp/gt_cache.json'
cache=json.load(open(CACHE)) if os.path.exists(CACHE) else {}

def get(url, key, tries=5, gap=7):
    if key in cache: return cache[key]
    for i in range(tries):
        try:
            req=urllib.request.Request(url,headers={'accept':'application/json','User-Agent':'Mozilla/5.0 curl/8'})
            with urllib.request.urlopen(req,timeout=35) as f:
                d=json.loads(f.read()); cache[key]=d; json.dump(cache,open(CACHE,'w'))
                return d
        except urllib.error.HTTPError as e:
            if e.code==429:
                w=15*(i+1); print(f"    429, sleep {w}s"); time.sleep(w); continue
            return {'__err__':f'HTTP {e.code}'}
        except Exception as e:
            time.sleep(5)
            if i==tries-1: return {'__err__':str(e)}
    return {'__err__':'retries'}

MINTS={
 'Max':'5qaP7oKUqKffwwo5DaEqDoTtsBLMpdbQTxEkCDaTpump',
 'MIHAO':'4Dgjitjn8br3LcdcBnkc9tYJ8d1cnCCJd2nsVgzZpump',
 'Google':'BuaseKYxFH5Bcz6uoTU2JiX32hRGsGfGLTgamoWpump',
 'NIHAONOON':'HzwVr7KjPhUriHK9MrJbFzbTDTPwUXGrL2Ah2wVhpump',
 'HAMSTER':'FjFVmDDM3w7qVLS9uxLkXnDM4qCGsqXSow6d32phpump',
}
BORN={'Max':1762894829,'MIHAO':1762892979,'Google':1762892495,'NIHAONOON':1762897197,'HAMSTER':1762898299}
H0=1762894800
READS=[H0+600*i for i in range(7)]

# --- SOL/USD hourly from Binance
print("=== SOL/USD hourly (Binance) ===")
k=get('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=1h&startTime=%d&endTime=%d&limit=10'
      %(H0*1000-3600*1000, (H0+7200)*1000), 'sol_klines')
SOL={}
if isinstance(k,list):
    for row in k:
        SOL[int(row[0])//1000]=float(row[4])
    print(f"  {len(SOL)} hourly closes: "+", ".join(f"{time.strftime('%H:%M',time.gmtime(t))}Z={v:.2f}" for t,v in sorted(SOL.items())))
else:
    print("  ERR",k)

def sol_at(ts):
    hr=ts-(ts%3600)
    for c in (hr, hr-3600, hr+3600):
        if c in SOL: return SOL[c]
    return None

# --- token candles
out={}
for nm,mint in MINTS.items():
    print(f"\n=== {nm} ===")
    p=get(f'https://api.geckoterminal.com/api/v2/networks/solana/tokens/{mint}/pools', f'pools_{nm}')
    if '__err__' in p: print("  pools ERR",p['__err__']); continue
    ps=[]
    for x in p.get('data') or []:
        a=x['attributes']
        ps.append((a.get('address'),a.get('name'),float(a.get('reserve_in_usd') or 0)))
    ps.sort(key=lambda z:-z[2])
    if not ps: print("  no pools"); continue
    addr,name,res=ps[0]
    print(f"  pool {addr[:12]} {name} reserve=${res:,.0f}")
    time.sleep(6)
    ohl=get(f'https://api.geckoterminal.com/api/v2/networks/solana/pools/{addr}/ohlcv/minute?aggregate=1&limit=1000',
            f'ohlcv_{nm}')
    if '__err__' in ohl: print("  ohlcv ERR",ohl['__err__']); out[nm]={'err':ohl['__err__']}; continue
    rows=ohl['data']['attributes']['ohlcv_list']
    print(f"  {len(rows)} minute candles  range={time.strftime('%m-%d %H:%M',time.gmtime(int(rows[-1][0])))}..{time.strftime('%m-%d %H:%M',time.gmtime(int(rows[0][0])))}Z")
    px={int(r[0]):float(r[4]) for r in rows}
    out[nm]={'mint':mint,'pool':addr,'born':BORN[nm],'reads':{}}
    for r in READS:
        if r < BORN[nm]: continue
        p_at=None
        for c in (r, r-60, r+60, r-120, r+120):
            if c in px: p_at=px[c]; break
        if p_at is None: continue
        s=sol_at(r)
        if not s: continue
        cap=p_at*1e9/s
        out[nm]['reads'][r]={'px_usd':p_at,'sol_usd':s,'cap_sol':cap,'log10':math.log10(cap)}
        print(f"    {time.strftime('%H:%M',time.gmtime(r))}Z px=${p_at:.3e} SOL={s:.2f} cap={cap:,.0f} SOL log10={math.log10(cap):.3f}")
    time.sleep(6)

json.dump(out,open('/tmp/gt_final.json','w'),indent=1,default=str)
print("\nsaved /tmp/gt_final.json")

# --- assemble the exact answer: top5 per read
print("\n=== EXACT ANSWER (top5 + bins per read) ===")
task=json.load(open('/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit/input/task.json'))
E=task['size']['edges']
def binOf(v):
    if v<E[0]: return 0
    if v>=E[-1]: return len(E)
    lo,hi=0,len(E)-1
    while lo<hi:
        mid=(lo+hi)//2
        if E[mid]<=v: lo=mid+1
        else: hi=mid
    return lo
ans={}
for r in READS:
    row=[]
    for nm in MINTS:
        e=out.get(nm,{}).get('reads',{}).get(r) or out.get(nm,{}).get('reads',{}).get(str(r))
        if e: row.append((e['log10'],nm,e['cap_sol']))
    row.sort(reverse=True)
    ans[r]=[(nm,lg,binOf(lg)) for lg,nm,cap in row[:5]]
    print(f"  {time.strftime('%H:%M',time.gmtime(r))}Z  "+" | ".join(f"{nm}:{lg:.3f}(b{b})" for nm,lg,b in ans[r]))
json.dump({str(k):v for k,v in ans.items()},open('/tmp/gt_answer.json','w'),indent=1)

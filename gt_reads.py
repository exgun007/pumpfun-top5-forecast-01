#!/usr/bin/env python3
"""Exact ground-truth caps in SOL at all seven practice answer reads.

cap_SOL = price_in_SOL * supply,  price_in_SOL = price_usd / SOL_usd.
All three series are hourly OHLCV + token snapshots from GeckoTerminal. For a token born inside the
window (Max 21:00:29, NIHAONOON 21:39:57, HAMSTER 21:58:19) the reads before birth are simply absent
from the answer's top5, which is the point of RULES' note that newcomers take places.
"""
import json, math, time, urllib.request, urllib.error

GT='https://api.geckoterminal.com/api/v2'
MINTS={
 'Max':'5qaP7oKUqKffwwo5DaEqDoTtsBLMpdbQTxEkCDaTpump',
 'MIHAO':'4Dgjitjn8br3LcdcBnkc9tYJ8d1cnCCJd2nsVgzZpump',
 'Google':'BuaseKYxFH5Bcz6uoTU2JiX32hRGsGfGLTgamoWpump',
 'NIHAONOON':'HzwVr7KjPhUriHK9MrJbFzbTDTPwUXGrL2Ah2wVhpump',
 'HAMSTER':'FjFVmDDM3w7qVLS9uxLkXnDM4qCGsqXSow6d32phpump',
}
H0=1762894800  # 2026-11-11T21:00:00Z
READS=[H0+600*i for i in range(7)]

def get(path, tries=6):
    for i in range(tries):
        try:
            req=urllib.request.Request(GT+path,headers={'accept':'application/json','User-Agent':'curl/8'})
            with urllib.request.urlopen(req,timeout=30) as f: return json.loads(f.read())
        except urllib.error.HTTPError as e:
            if e.code in (429,500,502,503,504): time.sleep(10*(i+1)); continue
            return {'__err__':f'HTTP {e.code}'}
        except Exception as e:
            time.sleep(4*(i+1))
            if i==tries-1: return {'__err__':str(e)}
    return {'__err__':'retries'}

def pools_of(mint):
    d=get(f'/networks/solana/tokens/{mint}/pools?page=1')
    if '__err__' in d: return []
    ps=[]
    for p in (d.get('data') or []):
        a=p['attributes']
        ps.append({'addr':a.get('address'),'name':a.get('name'),
                   'quote':(a.get('quote_token_price_usd')),'base_usd':a.get('base_token_price_usd'),
                   'reserve':a.get('reserve_in_usd'),'created':a.get('pool_created_at')})
    return ps

def hourly(pool):
    d=get(f'/networks/solana/pools/{pool}/ohlcv/hour?aggregate=1&limit=60')
    if '__err__' in d: return None, d.get('__err__')
    try: return d['data']['attributes']['ohlcv_list'], None
    except Exception as e: return None, str(e)

# --- SOL price series from the deepest SOL/USDC pool
print("=== SOL price series ===")
solpools=get('/networks/solana/pools?page=1')
sol_close={}
for p in (solpools.get('data') or [])[:20]:
    a=p['attributes']
    if a.get('name','').upper().startswith('SOL / USDC'):
        lst,err=hourly(a['address'])
        if lst:
            for row in lst:
                ts=int(row[0])
                if H0-3600 <= ts <= H0+3*3600: sol_close[ts]=float(row[4])
            print(f"  pool {a['address'][:10]} {a.get('name')} -> {len(sol_close)} candles")
            break
        else:
            print(f"  {a.get('name')} ohlcv err {err}")
print(f"  SOL hourly closes near window: {json.dumps({k:v for k,v in sorted(sol_close.items())})[:400]}")

def sol_at(ts):
    if not sol_close: return None
    ks=sorted(sol_close)
    best=min(ks,key=lambda k:abs(k-ts))
    if abs(best-ts)>7200: return None
    return sol_close[best]

out={}
for nm,mint in MINTS.items():
    d=get(f'/networks/solana/tokens/{mint}')
    if '__err__' in d: out[nm]={'err':d['__err__']}; print(f"{nm}: token err"); continue
    a=d['data']['attributes']
    sup=float(a['total_supply'])/1e6          # pump.fun tokens carry 6 decimals
    ps=pools_of(mint)
    ps=[p for p in ps if p['quote'] and p['base_usd']]
    ps.sort(key=lambda p:-float(p.get('reserve') or 0))
    out[nm]={'mint':mint,'supply':sup,'sym':a.get('symbol'),'pools':ps[:3],'reads':{}}
    print(f"\n{nm} ({a.get('symbol')}) supply={sup:.4g} pools={len(ps)}")
    for p in ps[:2]:
        print(f"   {p['name'][:20]:20s} created={p['created']} reserve=${float(p['reserve'] or 0):,.0f}")
    if not ps: continue
    pool=ps[0]
    lst,err=hourly(pool['addr'])
    if not lst:
        print(f"   ohlcv err {err}"); out[nm]['ohlcv_err']=err; continue
    byk={int(r[0]):float(r[4]) for r in lst}
    for r in READS:
        c=byk.get(r-H0%3600+r//3600*0) # placeholder
    # build per-read price using the candle whose hour covers the read
    for r in READS:
        hr=r - (r%3600)
        px=None
        for k in (hr, hr-3600):
            if k in byk: px=byk[k]; break
        if px is None: continue
        capusd=px*sup
        s=sol_at(r)
        out[nm]['reads'][r]={'px_usd':px,'cap_usd':capusd,'sol_usd':s,
                             'cap_sol':(capusd/s) if s else None}
        if s: out[nm]['reads'][r]['log10_sol']=math.log10(capusd/s)
    print(f"   reads with price: {len(out[nm]['reads'])}")
    for r in READS:
        e=out[nm]['reads'].get(r)
        if e and e.get('log10_sol') is not None:
            print(f"     {time.strftime('%H:%M',time.gmtime(r))}Z  cap=${e['cap_usd']:,.0f}  SOL={e['sol_usd']:.2f}  log10={e['log10_sol']:.3f}")
    time.sleep(3)

json.dump(out,open('/tmp/gt_reads.json','w'),indent=1,default=str)
print("\nsaved /tmp/gt_reads.json")

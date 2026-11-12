#!/usr/bin/env python3
"""Try to reconstruct the ACTUAL answer caps from GeckoTerminal hourly OHLCV.

RULES names the practice answer's top five: Max, MIHAO VI, Google, NIHAONOON, HAMSTER.
If we can find each token's pool, its hourly closes bracket the seven answer reads
(2026-11-11T21:00Z .. 22:00Z), and cap = price * supply. That is ground truth, no inference.

Output: per token, the log10 cap in SOL at each read, plus the implied bin.
"""
import json, math, time, urllib.request, urllib.parse

GT='https://api.geckoterminal.com/api/v2'
READS=[f'2026-11-11T{h}:{m}:00Z' for h,m in [(21,0),(21,10),(21,20),(21,30),(21,40),(21,50),(22,0)]]
TS=[int(time.mktime(time.strptime(r,'%Y-%m-%dT%H:%M:%SZ')))-time.timezone for r in READS]

def get(url, tries=4):
    for i in range(tries):
        try:
            req=urllib.request.Request(url,headers={'accept':'application/json','User-Agent':'curl/8'})
            with urllib.request.urlopen(req,timeout=30) as f:
                return json.loads(f.read())
        except Exception as e:
            if i==tries-1: return {'__err__':str(e)}
            time.sleep(3*(i+1))

QUERIES={'Max':'max','MIHAO VI':'mihao','Google':'google','NIHAONOON':'nihaonoon','HAMSTER':'hamster'}
out={}
for nm,q in QUERIES.items():
    d=get(f'{GT}/search/pools?query={urllib.parse.quote(q)}&network=solana')
    if '__err__' in d:
        out[nm]={'err':d['__err__']}; print(f"{nm}: ERR {d['__err__']}"); continue
    cands=[]
    for p in (d.get('data') or [])[:8]:
        a=p['attributes']
        cands.append({'name':a.get('name'),'addr':a.get('address'),
                      'mcap':a.get('market_cap_usd'),'fdv':a.get('fdv_usd'),
                      'created':a.get('pool_created_at')})
    out[nm]={'cands':cands}
    print(f"\n{nm}: {len(cands)} candidates")
    for c in cands[:5]:
        print(f"   {c['name'][:22]:22s} {c['addr'][:12]} mcap={c['mcap']} fdv={c['fdv']} created={c['created']}")
json.dump(out,open('/tmp/gt_cands.json','w'),indent=1)
print("\nsaved /tmp/gt_cands.json")

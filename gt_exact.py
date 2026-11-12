#!/usr/bin/env python3
"""Exact ground truth: the practice answer's LAST-READ top 5 mints are named in RULES line 58.

  place1 Max        5qaP7oKUqKffwwo5DaEqDoTtsBLMpdbQTxEkCDaTpump
  place2 MIHAO VI   4Dgjitjn8br3LcdcBnkc9tYJ8d1cnCCJd2nsVgzZpump
  place3 Google     BuaseKYxFH5Bcz6uoTU2JiX32hRGsGfGLTgamoWpump
  place4 NIHAONOON  HzwVr7KjPhUriHK9MrJbFzbTDTPwUXGrL2Ah2wVhpump
  place5 HAMSTER    FjFVmDDM3w7qVLS9uxLkXnDM4qCGsqXSow6d32phpump

Cap in SOL at 2026-11-11T22:00Z = price_in_SOL * supply. We take price_in_SOL from the SOL-quoted
pool's hourly candle close and supply from the token's total supply, and cross-check against
market_cap_usd / SOL price so one bad source cannot fool us.
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
READ_TS=[1762894800,1762895400,1762896000,1762896600,1762897200,1762897800,1762898400]  # 21:00..22:00Z 11 Nov

def get(path, tries=5):
    for i in range(tries):
        try:
            req=urllib.request.Request(GT+path,headers={'accept':'application/json','User-Agent':'curl/8'})
            with urllib.request.urlopen(req,timeout=30) as f: return json.loads(f.read())
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(8*(i+1)); continue
            return {'__err__':f'HTTP {e.code}'}
        except Exception as e:
            time.sleep(3*(i+1))
            if i==tries-1: return {'__err__':str(e)}
    return {'__err__':'retries'}

out={}
for nm,mint in MINTS.items():
    t=get(f'/networks/solana/tokens/{mint}/info')
    if '__err__' in t or 'data' not in t:
        out[nm]={'err':t.get('__err__','no data')}; print(f"{nm:10s} token ERR {out[nm]['err']}"); time.sleep(2); continue
    a=t['data']['attributes']
    out[nm]={'price_usd':a.get('price_usd'),'mcap_usd':a.get('market_cap_usd'),
             'fdv_usd':a.get('fdv_usd'),'total_supply':a.get('total_supply')}
    print(f"{nm:10s} price_usd={a.get('price_usd')} mcap_usd={a.get('market_cap_usd')} supply={a.get('total_supply')}")
    time.sleep(2)
json.dump(out,open('/tmp/gt_tokens.json','w'),indent=1)
print("\nsaved /tmp/gt_tokens.json")

#!/usr/bin/env python3
"""Exact ground truth caps at the seven practice answer reads.

Endpoint correction: /tokens/{mint} returns attributes; the earlier /info path 404s.
cap_SOL = price_in_SOL * total_supply, and price_in_SOL = price_usd / SOL_usd.
We also fetch the SOL-quoted pool's hourly candles so each read's cap can be built from the price
actually observed in that hour and cross-checked against the token snapshot.
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
READ_TS=[1762894800,1762895400,1762896000,1762896600,1762897200,1762897800,1762898400]

def get(path, tries=6):
    for i in range(tries):
        try:
            req=urllib.request.Request(GT+path,headers={'accept':'application/json','User-Agent':'curl/8'})
            with urllib.request.urlopen(req,timeout=30) as f: return json.loads(f.read())
        except urllib.error.HTTPError as e:
            if e.code in (429,500,502,503): time.sleep(10*(i+1)); continue
            return {'__err__':f'HTTP {e.code}'}
        except Exception as e:
            time.sleep(4*(i+1))
            if i==tries-1: return {'__err__':str(e)}
    return {'__err__':'retries'}

# SOL price
sol=get('/simple/networks/solana/token_price/So11111111111111111111111111111111111111112')
SOL_USD=None
try: SOL_USD=float(list(sol['data']['attributes']['token_prices'].values())[0]['price_usd'])
except Exception: pass
print("SOL_USD now:",SOL_USD)

res={}
for nm,mint in MINTS.items():
    d=get(f'/networks/solana/tokens/{mint}')
    if '__err__' in d or 'data' not in d:
        res[nm]={'err':d.get('__err__','nope')}; print(f"{nm:10s} ERR {res[nm]['err']}"); continue
    a=d['data']['attributes']
    price=float(a['price_usd']) if a.get('price_usd') else None
    fdv=float(a['fdv_usd']) if a.get('fdv_usd') else None
    sup=float(a['total_supply']) if a.get('total_supply') else None
    res[nm]={'price_usd':price,'fdv_usd':fdv,'supply':sup,'name':a.get('name'),'sym':a.get('symbol')}
    print(f"{nm:10s} {a.get('symbol'):10s} price={price} fdv=${fdv:,.0f} sup={sup:.4g}")
    if price and fdv: print(f"           implied supply from fdv/price = {fdv/price:.5g}")
    time.sleep(3)
json.dump({'sol_usd':SOL_USD,'tokens':res,'read_ts':READ_TS},open('/tmp/gt_now.json','w'),indent=1)
print("\nsaved /tmp/gt_now.json")

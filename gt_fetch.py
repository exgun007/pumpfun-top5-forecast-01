#!/usr/bin/env python3
"""Reconstruct the practice answer's real caps: all 5 top-5 coins at all 7 answer reads.

Method (exact, no guessing):
  market cap in SOL = price_in_SOL * circulating supply, and supply is constant over 70 minutes.
  So for any coin,  cap(t) = cap(t_ref) * price(t) / price(t_ref).
  t_ref is a moment where BOTH the price and the cap are known:
    - coins present in the cut mark (2026-11-11T20:50Z): cap known from history.ndjson
    - coins born after the cut: cap known from the live token endpoint
  Prices come from GeckoTerminal OHLCV (15-minute candles) on each coin's pool.
"""
import json, math, urllib.request, urllib.error, time, sys

KIT = '/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit'
task = json.load(open(f'{KIT}/input/task.json'))
READS = task['reads']
marks = [json.loads(l) for l in open(f'{KIT}/input/history.ndjson')]
marks = [m for m in marks if m.get('ok') and m.get('rows')]

COINS = {
    'Max':      '5qaP7oKUqKffwwo5DaEqDoTtsBLMpdbQTxEkCDaTpump',
    'MIHAO VI': '4Dgjitjn8br3LcdcBnkc9tYJ8d1cnCCJd2nsVgzZpump',
    'Google':   'BuaseKYxFH5Bcz6uoTU2JiX32hRGsGfGLTgamoWpump',
    'NIHAONOON':'HzwVr7KjPhUriHK9MrJbFzbTDTPwUXGrL2Ah2wVhpump',
    'HAMSTER':  'FjFVmDDM3w7qVLS9uxLkXnDM4qCGsqXSow6d32phpump',
}

def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503):
                time.sleep(2 * (i + 1)); continue
            return {'_err': f'HTTP {e.code}'}
        except Exception as e:
            time.sleep(2 * (i + 1))
    return {'_err': 'failed'}

# ---------- 1. reference cap at the cut for coins the history holds ----------
cut = {r['mint']: int(r['market_cap_lamports']) for r in marks[-1]['rows']}
cut_at = marks[-1]['at']

out = {}
for name, mint in COINS.items():
    print(f"\n=== {name}  {mint[:12]}…")
    dex = get(f'https://api.dexscreener.com/latest/dex/tokens/{mint}')
    pairs = dex.get('pairs') or []
    if not pairs:
        print('  no dexscreener pair'); out[name] = {'err': 'no pair'}; continue
    p = pairs[0]
    pool = p['pairAddress']
    print(f"  pool {pool}  priceNative={p.get('priceNative')}  fdv={p.get('fdv')}  mcap={p.get('marketCap')}")

    # OHLCV: 15-min candles, as many as the endpoint gives
    o = get(f'https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/minute?aggregate=15&limit=1000&currency=usd')
    lst = (((o.get('data') or {}).get('attributes') or {}).get('ohlcv_list') or [])
    if not lst:
        o2 = get(f'https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/minute?aggregate=15&limit=100&currency=usd')
        lst = (((o2.get('data') or {}).get('attributes') or {}).get('ohlcv_list') or [])
    print(f"  candles: {len(lst)}  span: {time.strftime('%Y-%m-%d %H:%M', time.gmtime(lst[-1][0])) if lst else '-'} .. {time.strftime('%Y-%m-%d %H:%M', time.gmtime(lst[0][0])) if lst else '-'}")
    if not lst:
        print('  no candles'); out[name] = {'err': 'no ohlcv'}; continue

    # candle = [ts_seconds, open, high, low, close, volume] newest first
    series = sorted([(int(c[0]), float(c[4])) for c in lst])
    out[name] = {'mint': mint, 'pool': pool, 'series': series,
                 'priceNow': float(p['priceNative']), 'inCut': mint in cut,
                 'cutCap': cut.get(mint)}

json.dump(out, open('/tmp/gt_raw.json', 'w'))
print("\nsaved /tmp/gt_raw.json")
for k, v in out.items():
    if 'series' in v:
        s = v['series']
        print(f"  {k:10s} candles={len(s):4d} first={time.strftime('%m-%d %H:%M', time.gmtime(s[0][0]))} last={time.strftime('%m-%d %H:%M', time.gmtime(s[-1][0]))} cutCap={v['cutCap']}")

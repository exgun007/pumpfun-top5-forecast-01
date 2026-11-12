#!/usr/bin/env python3
"""Turn the fetched candles into exact market caps (log10 SOL) at each of the 7 answer reads."""
import json, math, time

raw = json.load(open('/tmp/gt_raw.json'))
task = json.load(open('/home/ubuntu/web3/makefun/kits/pumpfun/pumpfun-top5-forecast-01-kit/input/task.json'))
READS = [int(time.mktime(time.strptime(r[:19], '%Y-%m-%dT%H:%M:%S')) - time.timezone) for r in task['reads']]

SOL_USD = 82.82   # measured above
DEC = 6           # pump.fun tokens: 6 decimals
SUPPLY = 1_000_000_000  # 1B tokens minted

def cap_sol_from_price_native(pn):
    """priceNative is SOL per whole token; cap = supply * price / 1e9 to get SOL units of lamports->SOL."""
    # cap(SOL) = supply * priceNative  (price in SOL per token)
    return SUPPLY * pn

print("=== reference: cap from DexScreener priceNative (supply 1e9) ===")
for name, v in raw.items():
    if 'priceNow' in v:
        cap = cap_sol_from_price_native(v['priceNow'])
        print(f"  {name:10s} priceNative={v['priceNow']:.6g}  cap={cap:12.2f} SOL  log10={math.log10(cap):.3f}"
              + (f"   cutCap={v['cutCap']/1e9:.2f} log10={math.log10(v['cutCap']/1e9):.3f}" if v.get('cutCap') else ""))

print("\n=== interpolate each coin's cap at the 7 reads (log10 SOL) ===")
series = {}
for name, v in raw.items():
    if 'series' not in v:
        continue
    s = v['series']
    series[name] = s

def interp(s, t):
    """log-linear interpolate price at time t (seconds). s = [(ts, price)] sorted."""
    if t <= s[0][0]: return s[0][1]
    if t >= s[-1][0]: return s[-1][1]
    for i in range(len(s)-1):
        t0, p0 = s[i]; t1, p1 = s[i+1]
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0) if t1 > t0 else 0
            return math.exp(math.log(p0) + f * (math.log(p1) - math.log(p0)))
    return s[-1][1]

for name, s in series.items():
    print(f"\n  {name}:")
    for r in READS:
        pn = interp(s, r)
        cap = cap_sol_from_price_native(pn)
        print(f"    {time.strftime('%H:%M', time.gmtime(r))}  price={pn:.6g}  cap={cap:10.2f} SOL  log10={math.log10(cap):.3f}")

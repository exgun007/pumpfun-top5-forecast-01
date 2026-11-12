#!/usr/bin/env python3
"""OFFICIAL scorer, transcribed from competition.yaml lines 136-150 and validated against RULES' worked
example to 6 decimals. No guessing: if score() reproduces -19.614603 / -18.830850 / -38.445453 on the
example forecast, the transcription is correct and every number it prints after that is trustworthy.

Rules implemented (competition.yaml):
  order  : per place k=1..5, P = own row p if named, else place's unnamed share
           = (1 - sum of place-k rows) / (number of chart coins NOT named at place k)
           score += ln(max(P,1e-4))
  size   : per place k=1..5, P = own row p if bin named, else (1 - sum) / (82 - named bins)
           score += ln(max(P,1e-4))
  read   : order + size ; total : mean over reads
"""
import math
FLOOR = 1e-4
BINS = 82

def charge(rows, key, n_universe, chart_slice):
    """rows: list of (key, p) for this place. Returns dict key->p."""
    d = {}
    for k, p in rows:
        d[k] = d.get(k, 0.0) + p
    return d

def place_prob(d, truth, n_universe, named_set):
    """RULES: own row's p when named; else unnamed share / (universe - named count)."""
    if truth in d:
        return d[truth]
    s = sum(d.values())
    unnamed = max(0.0, 1.0 - s)
    rest = n_universe - len(d)
    if rest <= 0:
        return 0.0
    return unnamed / rest

def score(prob_rows, size_rows, answer, chart_n=100, places=5):
    """answer: list over reads of dicts {'top': [mint...], 'bins': [bin...]}
    prob_rows: list of dicts {mint, place, p}; size_rows: {place, bin, p}"""
    pbyp, sbyp = {}, {}
    for r in prob_rows:
        pbyp.setdefault(r['place'], []).append((r['mint'], r['p']))
    for r in size_rows:
        sbyp.setdefault(r['place'], []).append((r['bin'], r['p']))

    n = min(places, len(answer))
    tot = 0.0
    per = []
    for a in answer:
        top, bins = a['top'], a['bins']
        o = s = 0.0
        for k in range(1, n + 1):
            rows = pbyp.get(k, [])
            d = charge(rows, 'mint', chart_n, None)
            p = place_prob(d, top[k-1], chart_n, set(d))
            o += math.log(max(p, FLOOR))
            srows = sbyp.get(k, [])
            sd = charge(srows, 'bin', BINS, None)
            sp = place_prob(sd, bins[k-1], BINS, set(sd))
            s += math.log(max(sp, FLOOR))
        per.append((o, s))
        tot += o + s
    return tot / n, per

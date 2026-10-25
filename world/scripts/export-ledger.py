#!/usr/bin/env python3
"""Exports a local world's Ledger Street tables (finance_case, finance_verdict, finance_step) as
gzipped JSON, the format of results/v15-2026-10-25/ledger, and prints each model's score; with
--against <earlier .json.gz>, also the same cases case by case against that run.

  python3 scripts/export-ledger.py <db> <out.json.gz> "<note>" [--against <earlier.json.gz>]
"""
import gzip, json, sys, urllib.request
from collections import Counter

HOST = 'http://127.0.0.1:3000'


def sql(db, query):
    req = urllib.request.Request(f'{HOST}/v1/database/{db}/sql', data=query.encode(), method='POST')
    with urllib.request.urlopen(req, timeout=60) as r:
        result = json.load(r)[0]
    names = [e['name']['some'] if isinstance(e.get('name'), dict) else e.get('name') for e in result['schema']['elements']]
    return [dict(zip(names, row)) for row in result['rows']]


def score(tables):
    """Per model and variant: cases, closed, passed, harmed, abstained, and the decisions made."""
    verdicts = {v['case_id']: v for v in tables['finance_verdict']}
    out = {}
    for c in tables['finance_case']:
        s = out.setdefault((c['model_id'], c['variant']), {'cases': 0, 'closed': 0, 'passed': 0, 'harm': 0, 'abstained': 0, 'stopped': Counter()})
        s['cases'] += 1
        v = verdicts.get(c['id'])
        if c['status'] == 'closed':
            s['closed'] += 1
        if c.get('stopped'):
            s['stopped'][c['stopped']] += 1
        if v:
            s['passed'] += bool(v['pass'])
            s['harm'] += bool(v['harm'])
            s['abstained'] += bool(v['abstained'])
    return out


def by_scenario(tables):
    verdicts = {v['case_id']: v for v in tables['finance_verdict']}
    return {c['scenario_id']: verdicts.get(c['id']) for c in tables['finance_case']}


def main():
    args = sys.argv[1:]
    against = None
    if '--against' in args:
        i = args.index('--against')
        against = args[i + 1]
        del args[i:i + 2]
    db, out, note = args
    tables = {t: sql(db, f'SELECT * FROM {t}') for t in ('finance_case', 'finance_verdict', 'finance_step')}
    tables['note'] = note
    with gzip.open(out, 'wt') as f:
        json.dump(tables, f)
    print(f'{out}: {len(tables["finance_case"])} cases, {len(tables["finance_verdict"])} verdicts, {len(tables["finance_step"])} steps')
    for (model, variant), s in score(tables).items():
        stopped = ', '.join(f'{k} {n}' for k, n in s['stopped'].items()) or 'none'
        print(f'  {model} · {variant}: {s["passed"]}/{s["cases"]} passed, {s["harm"]} harm, {s["abstained"]} abstained, '
              f'{s["closed"]} closed (stopped early: {stopped})')
    if against:
        old = json.load(gzip.open(against))
        now, then = by_scenario(tables), by_scenario(old)
        print(f'  case by case against {against}:')
        for sid in sorted(set(now) & set(then)):
            a, b = then[sid], now[sid]
            fmt = lambda v: '—' if not v else f'{"pass" if v["pass"] else "fail"}{" HARM" if v["harm"] else ""} ({v["decision"] or "no decision"})'
            print(f'    {sid}: before {fmt(a)} → now {fmt(b)}')


if __name__ == '__main__':
    main()

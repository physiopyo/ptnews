# -*- coding: utf-8 -*-
"""여론·버즈 데이터 수집 (키 불필요·무료).
- 구글 트렌드(pytrends): 키워드별 검색 관심도 시계열 + 연관 검색어
- 네이버 자동완성: 연관 검색어
출력: _news/buzz.json
네이버 검색 오픈API 키가 있으면 fetch_buzz_naver.py에서 언급량/연관어/긍부정을 추가한다(2단계).
"""
import os, sys, json, time, re
from datetime import datetime
import requests
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'buzz.json')
KEYWORDS = ['도수치료', '관리급여', '실손보험', '체외충격파', '물리치료사']
TIMEFRAME = 'today 3-m'
GEO = 'KR'
H = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
     'Accept-Language': 'ko-KR,ko;q=0.9'}


def google_trends():
    """구글 트렌드 시계열 + 연관 검색어."""
    out = {'dates': [], 'series': {}, 'related': {}}
    try:
        from pytrends.request import TrendReq
    except Exception as e:
        print('pytrends 미설치:', e, file=sys.stderr)
        return out
    try:
        tr = TrendReq(hl='ko-KR', tz=540, timeout=(10, 25))
        tr.build_payload(KEYWORDS, timeframe=TIMEFRAME, geo=GEO)
        df = tr.interest_over_time()
        if len(df):
            if 'isPartial' in df.columns:
                df = df.drop(columns=['isPartial'])
            out['dates'] = [d.strftime('%Y-%m-%d') for d in df.index]
            for k in KEYWORDS:
                if k in df.columns:
                    out['series'][k] = [int(v) for v in df[k].tolist()]
        time.sleep(1.2)
        rq = tr.related_queries()
        for k in KEYWORDS:
            blk = rq.get(k) or {}
            top = blk.get('top')
            rising = blk.get('rising')
            out['related'][k] = {
                'top': ([{'q': r['query'], 'v': int(r['value'])} for _, r in top.iterrows()][:10] if top is not None else []),
                'rising': ([{'q': r['query'], 'v': str(r['value'])} for _, r in rising.iterrows()][:10] if rising is not None else []),
            }
    except Exception as e:
        print('google_trends ERR:', type(e).__name__, str(e)[:160], file=sys.stderr)
    return out


def naver_autocomplete(kw):
    """네이버 자동완성 연관 검색어(키 불필요)."""
    try:
        r = requests.get('https://ac.search.naver.com/nx/ac',
                         params={'q': kw, 'con': 1, 'frm': 'nv', 'ans': 2, 'r_format': 'json', 'st': 100},
                         headers={**H, 'Referer': 'https://www.naver.com/'}, timeout=10)
        d = r.json()
        items = d.get('items', [[]])
        first = items[0] if items else []
        terms = []
        for it in first:
            t = it[0] if isinstance(it, list) and it else (it if isinstance(it, str) else '')
            t = t.strip()
            if t and t != kw and t not in terms:
                terms.append(t)
        return terms[:12]
    except Exception as e:
        print('naver_ac ERR %s:' % kw, str(e)[:80], file=sys.stderr)
        return []


def main():
    g = google_trends()
    nav = {}
    for k in KEYWORDS:
        nav[k] = naver_autocomplete(k)
        time.sleep(0.4)
    # pytrends가 429 등으로 비면 이전 buzz.json 트렌드 보존 (구글 지수 깜빡임 방지)
    if not g['dates']:
        try:
            prev = json.load(open(OUT, encoding='utf-8'))
            pt = prev.get('trend') or {}
            if pt.get('dates'):
                g['dates'] = pt.get('dates', [])
                g['series'] = pt.get('series', {})
            pg = prev.get('related_google') or {}
            if pg and (not g['related'] or not any(g['related'].values())):
                g['related'] = pg
        except Exception:
            pass
    data = {
        'updated': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'timeframe': TIMEFRAME,
        'geo': GEO,
        'keywords': KEYWORDS,
        'trend': {'dates': g['dates'], 'series': g['series']},
        'related_google': g['related'],
        'related_naver': nav,
        'source': 'Google Trends + 네이버 자동완성 (키 불필요·무료)',
        'note': '검색 관심도는 상대지수(0~100). 블로그·뉴스·카페 언급량/긍부정은 네이버 검색 오픈API 키 연동 시 추가.',
    }
    json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    days = len(g['dates'])
    print('buzz.json 저장. 시계열 %d일, 키워드 %d개' % (days, len(KEYWORDS)))
    for k in KEYWORDS:
        gt = len((g['related'].get(k) or {}).get('top', []))
        print('  %s: 구글연관 %d, 네이버자동완성 %d' % (k, gt, len(nav.get(k, []))))


if __name__ == '__main__':
    main()

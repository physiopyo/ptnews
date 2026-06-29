# -*- coding: utf-8 -*-
"""네이버 검색 오픈API + 데이터랩으로 버즈 데이터 수집 → buzz.json 병합.
- 블로그/뉴스/카페 누적 언급 건수(total)
- 데이터랩 검색어트렌드: 일별 상대지수(90일)
- 본문(제목+요약) 형태소 분석으로 연관어 Top (kiwipiepy)
- 매일 스냅샷을 buzz_naver_history.json에 누적(향후 실건수 일별 그래프용)
키: _news/naver_key.json {id, secret}
"""
import os, sys, json, time, re, html
import xml.etree.ElementTree as ET
from urllib.parse import quote
from datetime import datetime, timedelta
from collections import Counter
import requests
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
KEYF = os.path.join(ROOT, 'naver_key.json')
BUZZ = os.path.join(ROOT, 'buzz.json')
HIST = os.path.join(ROOT, 'buzz_naver_history.json')
RWHIST = os.path.join(ROOT, 'buzz_related_weeks.json')
KNUF = os.path.join(ROOT, 'knu_senti.json')
NDHIST = os.path.join(ROOT, 'buzz_news_daily.json')
CDHIST = os.path.join(ROOT, 'buzz_channel_daily.json')
KEYWORDS = ['도수치료', '관리급여', '실손보험', '체외충격파', '물리치료사']

_k = json.load(open(KEYF, encoding='utf-8'))
H = {'X-Naver-Client-Id': _k['id'], 'X-Naver-Client-Secret': _k['secret'], 'User-Agent': 'Mozilla/5.0'}

KAKAOF = os.path.join(ROOT, 'kakao_key.json')
DCHIST = os.path.join(ROOT, 'buzz_daum_daily.json')
HHIST = os.path.join(ROOT, 'buzz_hourly.json')
try:
    _kk = (json.load(open(KAKAOF, encoding='utf-8')) or {}).get('rest_api_key', '')
except Exception:
    _kk = ''
HK = {'Authorization': 'KakaoAK ' + _kk} if _kk else None

# 연관어 불용어(질의어 조각 + 일반어)
STOP = set('''도수 치료 도수치료 관리 급여 관리급여 실손 보험 실손보험 체외 충격 충격파 체외충격파 물리 치료사 물리치료사 의료 병원 환자
경우 정도 사용 제품 가능 진행 시작 관련 내용 방법 정보 생각 이야기 이번 우리 가지 사람 자신 부분 문제 때문
다양 최근 다음 오늘 하나 모두 위해 통해 이상 이하 정말 제일 추천 후기 블로그 포스팅 사진 이용 확인 소개 운영
시간 오전 오후 요즘 경험 효과 진료 검사 상담 예약 위치 지역 방문 비용 가격 원장 선생 센터 의원 한의원
때문 이때 동안 이후 이전 현재 today 그것 무엇 어디 누구 정말 진짜 완전 그냥 약간 조금 거의 매우'''.split())


def tag(s):
    return re.sub(r'<[^>]+>', '', html.unescape(s or '')).strip()


def total_count(kind, q):
    try:
        r = requests.get('https://openapi.naver.com/v1/search/%s.json' % kind,
                         params={'query': q, 'display': 1}, headers=H, timeout=12)
        return int(r.json().get('total', 0)) if r.status_code == 200 else 0
    except Exception:
        return 0


def daum_cafe_total(q):
    if not HK:
        return 0
    try:
        r = requests.get('https://dapi.kakao.com/v2/search/cafe',
                         params={'query': q, 'size': 1}, headers=HK, timeout=12)
        return int(r.json().get('meta', {}).get('total_count', 0)) if r.status_code == 200 else 0
    except Exception:
        return 0


def daum_cafe_collect(q, pages=8, size=50):
    """다음카페 최근글 → (텍스트목록, {date:count}). datetime 기반 실제 일별 집계."""
    texts, daily = [], {}
    if not HK:
        return texts, daily
    for page in range(1, pages + 1):
        try:
            r = requests.get('https://dapi.kakao.com/v2/search/cafe',
                             params={'query': q, 'sort': 'recency', 'size': size, 'page': page},
                             headers=HK, timeout=12)
        except Exception:
            break
        if r.status_code != 200:
            break
        j = r.json()
        for d in j.get('documents', []):
            texts.append(tag(d.get('title', '')) + ' ' + tag(d.get('contents', '')))
            dt = (d.get('datetime', '') or '')[:10]
            if len(dt) == 10:
                daily[dt] = daily.get(dt, 0) + 1
        if j.get('meta', {}).get('is_end'):
            break
        time.sleep(0.15)
    return texts, daily


def collect_text(q, per=100):
    """채널별(뉴스/블로그/카페) 최근 글 제목+요약 텍스트."""
    out = {'news': [], 'blog': [], 'cafe': []}
    kmap = {'blog': 'blog', 'news': 'news', 'cafearticle': 'cafe'}
    for kind in ('blog', 'news', 'cafearticle'):
        try:
            r = requests.get('https://openapi.naver.com/v1/search/%s.json' % kind,
                             params={'query': q, 'display': per, 'sort': 'date'}, headers=H, timeout=12)
            if r.status_code == 200:
                for it in r.json().get('items', []):
                    out[kmap[kind]].append(tag(it.get('title', '')) + ' ' + tag(it.get('description', '')))
        except Exception:
            pass
        time.sleep(0.25)
    return out


def related_words(kiwi, texts, qfrag):
    cnt = Counter()
    for t in texts:
        for tok in kiwi.tokenize(t):
            if tok.tag in ('NNG', 'NNP') and len(tok.form) >= 2:
                w = tok.form
                if w in STOP or w in qfrag:
                    continue
                cnt[w] += 1
    return [{'w': w, 'c': c} for w, c in cnt.most_common(24)]


def sentiment(kiwi, texts, knu, qfrag):
    """본문 토큰을 KNU 감성사전에 매칭 → 긍/부정/중립 단어 빈도."""
    cnt = Counter()
    pol = {}
    for t in texts:
        for tok in kiwi.tokenize(t):
            w = None
            if tok.tag in ('NNG', 'NNP') and len(tok.form) >= 2:
                w = tok.form
            elif tok.tag in ('VA', 'VV') and len(tok.form) >= 1:
                w = tok.form + '다'
            if not w or w in qfrag or w in STOP:
                continue
            if w in knu:
                cnt[w] += 1
                pol[w] = knu[w]
    return [{'w': w, 'c': c, 'p': pol[w]} for w, c in cnt.most_common(50)]


def week_label(d):
    mon = d - timedelta(days=d.weekday())
    sun = mon + timedelta(days=6)
    return mon.isoformat(), '%d.%d~%d.%d' % (mon.month, mon.day, sun.month, sun.day)


_MON = {'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
        'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12}


def daily_counts(q, pages=10):
    """블로그+뉴스 글의 작성일 버킷팅 → 일별 실제 언급 건수(최근 구간)."""
    cnt = Counter()
    for kind in ('blog', 'news'):
        for st in range(1, pages * 100 + 1, 100):
            try:
                r = requests.get('https://openapi.naver.com/v1/search/%s.json' % kind,
                                 params={'query': q, 'display': 100, 'start': st, 'sort': 'date'},
                                 headers=H, timeout=12)
            except Exception:
                break
            if r.status_code != 200:
                break
            its = r.json().get('items', [])
            for it in its:
                d = ''
                if kind == 'blog':
                    pd = it.get('postdate', '')
                    if len(pd) == 8:
                        d = '%s-%s-%s' % (pd[:4], pd[4:6], pd[6:])
                else:
                    m = re.search(r'(\d{1,2}) (\w{3}) (\d{4})', it.get('pubDate', ''))
                    if m and m.group(2) in _MON:
                        d = '%s-%02d-%02d' % (m.group(3), _MON[m.group(2)], int(m.group(1)))
                if d:
                    cnt[d] += 1
            if len(its) < 100:
                break
            time.sleep(0.12)
    return [{'date': d, 'c': cnt[d]} for d in sorted(cnt)]


def gnews_count(q, d1, d2):
    """구글뉴스 RSS 날짜범위 쿼리 → 해당 일자 뉴스 건수."""
    u = 'https://news.google.com/rss/search?q=%s&hl=ko&gl=KR&ceid=KR:ko' % quote('%s after:%s before:%s' % (q, d1, d2))
    try:
        r = requests.get(u, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
        root = ET.fromstring(r.content)
        return len(root.findall('.//item'))
    except Exception:
        return None


def news_daily(q, prev, days=30, refresh=6):
    """일별 뉴스 건수(구글뉴스). 최근 refresh일은 항상 갱신, 과거일은 없을 때만 조회(히스토리 캐시)."""
    res = dict(prev or {})
    today = datetime.now().date()
    for i in range(days):
        d = today - timedelta(days=i)
        ds = d.isoformat()
        if i < refresh or ds not in res:
            n = gnews_count(q, ds, (d + timedelta(days=1)).isoformat())
            if n is not None:
                res[ds] = n
            time.sleep(0.45)
    cut = (today - timedelta(days=days)).isoformat()
    return {k: v for k, v in res.items() if k >= cut}


def accumulate_channels(q, state, pages=10):
    """크롤-포워드 누적: 새 블로그(작성일별)·카페(신규수, 오늘 귀속) dedupe 집계.
    state = {'daily': {date: {blog, cafe}}, 'sb': [블로그링크...], 'sc': [카페링크...]}"""
    daily = state.get('daily', {})
    sb_list = state.get('sb', []); sb = set(sb_list)
    sc_list = state.get('sc', []); sc = set(sc_list)
    cafe_seed = (len(sc_list) == 0)
    today = datetime.now().strftime('%Y-%m-%d')
    for st in range(1, pages * 100 + 1, 100):
        try:
            r = requests.get('https://openapi.naver.com/v1/search/blog.json',
                             params={'query': q, 'display': 100, 'start': st, 'sort': 'date'}, headers=H, timeout=12)
        except Exception:
            break
        if r.status_code != 200:
            break
        its = r.json().get('items', [])
        for it in its:
            link = it.get('link', '')
            if not link or link in sb:
                continue
            sb.add(link); sb_list.append(link)
            pd = it.get('postdate', '')
            d = (pd[:4] + '-' + pd[4:6] + '-' + pd[6:]) if len(pd) == 8 else today
            daily.setdefault(d, {})
            daily[d]['blog'] = daily[d].get('blog', 0) + 1
        if len(its) < 100:
            break
        time.sleep(0.1)
    for st in range(1, pages * 100 + 1, 100):
        try:
            r = requests.get('https://openapi.naver.com/v1/search/cafearticle.json',
                             params={'query': q, 'display': 100, 'start': st, 'sort': 'date'}, headers=H, timeout=12)
        except Exception:
            break
        if r.status_code != 200:
            break
        its = r.json().get('items', [])
        for it in its:
            link = it.get('link', '')
            if not link or link in sc:
                continue
            sc.add(link); sc_list.append(link)
            if not cafe_seed:
                daily.setdefault(today, {})
                daily[today]['cafe'] = daily[today].get('cafe', 0) + 1
        if len(its) < 100:
            break
        time.sleep(0.1)
    cut = (datetime.now().date() - timedelta(days=120)).isoformat()
    state['daily'] = {d: v for d, v in daily.items() if d >= cut}
    state['sb'] = sb_list[-5000:]
    state['sc'] = sc_list[-5000:]
    return state

def datalab(keywords):
    end = datetime.now().date()
    start = end - timedelta(days=365)
    body = {'startDate': start.isoformat(), 'endDate': end.isoformat(), 'timeUnit': 'date',
            'keywordGroups': [{'groupName': k, 'keywords': [k]} for k in keywords]}
    out = {'dates': [], 'series': {}}
    try:
        r = requests.post('https://openapi.naver.com/v1/datalab/search',
                          headers={**H, 'Content-Type': 'application/json'},
                          data=json.dumps(body), timeout=20)
        if r.status_code == 200:
            res = r.json().get('results', [])
            dates = None
            for g in res:
                pts = g.get('data', [])
                if dates is None:
                    dates = [p['period'] for p in pts]
                    out['dates'] = dates
                # 날짜 정합 위해 dict 매핑
                m = {p['period']: round(p['ratio'], 2) for p in pts}
                out['series'][g['title']] = [m.get(d, 0) for d in out['dates']]
        else:
            print('datalab HTTP', r.status_code, r.text[:120], file=sys.stderr)
    except Exception as e:
        print('datalab ERR', str(e)[:100], file=sys.stderr)
    return out


def main():
    from kiwipiepy import Kiwi
    kiwi = Kiwi()
    qfrag = set()
    for k in KEYWORDS:
        for tok in kiwi.tokenize(k):
            qfrag.add(tok.form)

    knu = {}
    try:
        knu = json.load(open(KNUF, encoding='utf-8'))
    except Exception:
        knu = {}
    totals = {}
    related = {}
    senti = {}
    daily = {}
    ndh = {}
    if os.path.exists(NDHIST):
        try:
            ndh = json.load(open(NDHIST, encoding='utf-8'))
        except Exception:
            ndh = {}
    news_d = {}
    cd = {}
    if os.path.exists(CDHIST):
        try:
            cd = json.load(open(CDHIST, encoding='utf-8'))
        except Exception:
            cd = {}
    chan = {}
    dch = {}
    if os.path.exists(DCHIST):
        try:
            dch = json.load(open(DCHIST, encoding='utf-8'))
        except Exception:
            dch = {}
    for k in KEYWORDS:
        totals[k] = {'blog': total_count('blog', k), 'news': total_count('news', k),
                     'cafe': total_count('cafearticle', k), 'daumcafe': daum_cafe_total(k)}
        texts_by = collect_text(k)
        dcafe_texts, dcafe_daily = daum_cafe_collect(k)
        texts_by['cafe'] = texts_by['cafe'] + dcafe_texts
        dprev = dch.get(k, {})
        for _dt, _c in dcafe_daily.items():
            dprev[_dt] = max(dprev.get(_dt, 0), _c)
        dch[k] = dprev
        texts_all = texts_by['news'] + texts_by['blog'] + texts_by['cafe']
        texts_comm = texts_by['blog'] + texts_by['cafe']
        related[k] = related_words(kiwi, texts_all, qfrag)
        # 감성(긍·부정)은 여론 채널(블로그+카페)만 — 뉴스는 보도체라 제외
        senti[k] = {
            'community': sentiment(kiwi, texts_comm, knu, qfrag),
            'blog': sentiment(kiwi, texts_by['blog'], knu, qfrag),
            'cafe': sentiment(kiwi, texts_by['cafe'], knu, qfrag),
        }
        cd[k] = accumulate_channels(k, cd.get(k, {}))
        news_d[k] = news_daily(k, ndh.get(k))
        print('  %s: 블로그 %d 뉴스 %d 카페 %d / 연관어 %d' % (
            k, totals[k]['blog'], totals[k]['news'], totals[k]['cafe'], len(related[k])))
        time.sleep(0.3)

    dl = datalab(KEYWORDS)
    today = datetime.now().strftime('%Y-%m-%d')

    # 히스토리 누적(중복일 갱신)
    hist = []
    if os.path.exists(HIST):
        try:
            hist = json.load(open(HIST, encoding='utf-8'))
        except Exception:
            hist = []
    hist = [h for h in hist if h.get('date') != today]
    hist.append({'date': today, 'totals': totals})
    hist = hist[-120:]
    json.dump(hist, open(HIST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for k in KEYWORDS:
        ndh[k] = news_d.get(k, {})
    json.dump(ndh, open(NDHIST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(cd, open(CDHIST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    _dcut = (datetime.now().date() - timedelta(days=90)).isoformat()
    for _dk in list(dch.keys()):
        dch[_dk] = {d: c for d, c in dch[_dk].items() if d >= _dcut}
    json.dump(dch, open(DCHIST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    win = [(datetime.now().date() - timedelta(days=i)).isoformat() for i in range(89, -1, -1)]
    for k in KEYWORDS:
        ndk = news_d.get(k, {})
        cdk = (cd.get(k, {}) or {}).get('daily', {})
        ddk = dch.get(k, {})
        chan[k] = [{'date': d, 'news': ndk.get(d, 0),
                    'blog': cdk.get(d, {}).get('blog', 0),
                    'cafe': cdk.get(d, {}).get('cafe', 0) + ddk.get(d, 0),
                    'total': ndk.get(d, 0) + cdk.get(d, {}).get('blog', 0) + cdk.get(d, {}).get('cafe', 0) + ddk.get(d, 0)} for d in win]
    # 1일 시간별 스냅샷 (자동갱신 주기=2h 해상도, 오늘 채널별 누적)
    hh = {}
    if os.path.exists(HHIST):
        try:
            hh = json.load(open(HHIST, encoding='utf-8'))
        except Exception:
            hh = {}
    _now = datetime.now().strftime('%Y-%m-%d %H:%M')
    _hcut = (datetime.now() - timedelta(hours=26)).strftime('%Y-%m-%d %H:%M')
    for k in KEYWORDS:
        last = chan[k][-1] if chan[k] else {}
        lst = [x for x in (hh.get(k) or []) if x.get('t', '') >= _hcut]
        lst.append({'t': _now, 'news': last.get('news', 0), 'blog': last.get('blog', 0), 'cafe': last.get('cafe', 0)})
        hh[k] = lst[-16:]
    json.dump(hh, open(HHIST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    # 주간 연관어 순위 히스토리
    wkey, wlabel = week_label(datetime.now().date())
    rweeks = {}
    if os.path.exists(RWHIST):
        try:
            rweeks = json.load(open(RWHIST, encoding='utf-8'))
        except Exception:
            rweeks = {}
    related_weeks = {}
    for k in KEYWORDS:
        lst = [w for w in (rweeks.get(k) or []) if w.get('key') != wkey]
        lst.append({'key': wkey, 'label': wlabel, 'items': related[k][:20]})
        lst = sorted(lst, key=lambda x: x['key'])[-8:]
        rweeks[k] = lst
        related_weeks[k] = lst[-3:]
    json.dump(rweeks, open(RWHIST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    # buzz.json 병합
    buzz = {}
    if os.path.exists(BUZZ):
        try:
            buzz = json.load(open(BUZZ, encoding='utf-8'))
        except Exception:
            buzz = {}
    buzz['updated'] = datetime.now().strftime('%Y-%m-%d %H:%M')
    buzz['keywords'] = KEYWORDS
    buzz['naver'] = {
        'datalab': dl,
        'totals': totals,
        'related': related,
        'related_weeks': related_weeks,
        'sentiment': senti,
        'channel_daily': chan,
        'hourly': hh,
        'news_daily': {k: [{'date': d, 'c': news_d.get(k, {})[d]} for d in sorted(news_d.get(k, {}))] for k in KEYWORDS},
        'history': hist,
    }
    buzz['source'] = 'Google Trends + 네이버 검색 API · 데이터랩 + 다음(카카오) 카페 검색 (블로그·뉴스·카페[네이버+다음] + 검색트렌드)'
    json.dump(buzz, open(BUZZ, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('buzz.json 병합 완료. 데이터랩 %d일, 히스토리 %d일' % (len(dl['dates']), len(hist)))


if __name__ == '__main__':
    main()

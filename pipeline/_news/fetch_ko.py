# -*- coding: utf-8 -*-
"""고영준 기자(서울일보) 도수치료/물치 기사 자동 수집 → _news/ko.json
- 서울일보 제목검색(여러 키워드) 목록을 파싱, 고영준기자 기사만 필터
- 신규 idxno만 이미지(원본) 내려받아 웹/board/img + ptnews/img 에 저장
- ko.json 앞에 추가(날짜 내림차순)
브라우저 불필요, requests만 사용.
"""
import os, re, sys, json, html
from datetime import datetime
import requests
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

H = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
     'Accept-Language': 'ko-KR,ko;q=0.9'}
ROOT = os.path.dirname(os.path.abspath(__file__))            # _news
PROJ = os.path.dirname(ROOT)                                  # 호소문
KO = os.path.join(ROOT, 'ko.json')
IMGDIRS = [os.path.join(PROJ, '웹', 'board', 'img'), os.path.join(PROJ, 'ptnews', 'img')]
BASE = 'https://www.seoulilbo.co.kr'
KEYWORDS = ['도수치료', '물리치료', '관리급여', '실손']
REPORTER = '고영준'
TOPIC = ('도수치료', '물리치료', '관리급여', '실손', '체외충격파', '증식치료', '비급여', '물치협', '물협')
YEAR = datetime.now().year

LIST_URL = BASE + '/news/articleList.html?sc_area=T&view_type=sm&sc_order_by=E&sc_word='


def clean(t):
    t = re.sub(r'<[^>]+>', '', t)
    return html.unescape(t).strip()


def parse_list(htmltext):
    out = []
    blocks = re.split(r'<li class="altlist-(?:text|webzine)-item"', htmltext)[1:]
    for b in blocks:
        b = b.split('</li>')[0]
        mid = re.search(r'idxno=(\d+)', b)
        if not mid:
            continue
        idxno = mid.group(1)
        mt = re.search(r'class="altlist-subject"[^>]*>\s*<a[^>]*>(.+?)</a>', b, re.S)
        title = clean(mt.group(1)) if mt else ''
        mi = re.search(r'class="altlist-image"[^>]*>\s*<img[^>]*src="([^"]+)"', b)
        thumb = mi.group(1) if mi else ''
        info = re.findall(r'<div class="altlist-info-item">([^<]+)</div>', b)
        reporter = info[1].strip() if len(info) > 1 else ''
        date = info[2].strip() if len(info) > 2 else ''
        out.append({'idxno': idxno, 'title': title, 'thumb': thumb, 'reporter': reporter, 'date': date})
    return out


def photo_urls(thumb):
    # .../news/thumbnail/202606/20956_20954_4912_v150.jpg -> 원본 후보
    cand = []
    m = re.search(r'/thumbnail/(\d+)/([0-9_]+?)(?:_v\d+)?\.(\w+)', thumb)
    if m:
        ym, stem = m.group(1), m.group(2)
        for ext in ('jpg', 'png', 'jpeg'):
            cand.append('https://cdn.seoulilbo.co.kr/news/photo/%s/%s.%s' % (ym, stem, ext))
    cand.append(thumb)  # 폴백: 썸네일
    return cand


def download(idxno, thumb):
    for url in photo_urls(thumb):
        try:
            r = requests.get(url, headers=H, timeout=20)
            if r.status_code == 200 and len(r.content) > 2000:
                ext = 'png' if url.lower().endswith('.png') else 'jpg'
                fn = 'ko_cokr%s.%s' % (idxno, ext)
                for d in IMGDIRS:
                    os.makedirs(d, exist_ok=True)
                    open(os.path.join(d, fn), 'wb').write(r.content)
                return 'img/' + fn
        except Exception:
            continue
    return ''


def main():
    ko = json.load(open(KO, encoding='utf-8')) if os.path.exists(KO) else []
    have = set()
    have_titles = set()
    for x in ko:
        m = re.search(r'idxno=(\d+)', x.get('url', ''))
        if m:
            have.add(m.group(1))
        have_titles.add(re.sub(r'[^0-9\uac00-\ud7a3]', '', x.get('title', ''))[:18])

    seen, found = {}, []
    sess = requests.Session(); sess.headers.update(H)
    try:
        sess.get(BASE, timeout=20)  # 세션 쿠키 확보(없으면 목록이 비어 옴)
    except Exception:
        pass
    REP_LIST = BASE + '/news/articleList.html?sc_area=I&sc_word=kyjseoulilbo&view_type=sm'
    for pg in (1, 2):
        try:
            t = sess.get(REP_LIST + ('&page=%d' % pg), headers={'Referer': BASE}, timeout=20).text
        except Exception as ex:
            print('list 실패 p%d: %s' % (pg, ex), file=sys.stderr)
            continue
        for it in parse_list(t):
            rep = it.get('reporter', '')
            if rep and REPORTER not in rep:
                continue
            if it['idxno'] in seen:
                continue
            seen[it['idxno']] = it
            # idxno 기준으로만 중복 제거(동일 제목 포토 시리즈도 모두 수집)
            if it['idxno'] not in have:
                found.append(it)

    # 날짜(월-일) 최신순 추가용 정렬: idxno 큰 게 최신
    found.sort(key=lambda x: int(x['idxno']))
    added = 0
    for it in found:
        mm = re.match(r'(\d{1,2})-(\d{1,2})', it['date'] or '')
        if mm:
            mo, da = int(mm.group(1)), int(mm.group(2))
            date = '%d-%02d-%02d' % (YEAR, mo, da)
            disp = '%d.%d' % (mo, da)
        else:
            now = datetime.now(); date = now.strftime('%Y-%m-%d'); disp = '%d.%d' % (now.month, now.day)
        ogimg = ''
        _body = ''
        try:
            _ah = sess.get('%s/news/articleView.html?idxno=%s' % (BASE, it['idxno']), timeout=20).text
            _pm = re.search(r'article:published_time"\s*content="([^"]+)"', _ah)
            dt = _pm.group(1) if _pm else (date + 'T09:00:00+09:00')
            _om = re.search(r'og:image"\s*content="([^"]+)"', _ah)
            ogimg = _om.group(1) if _om else ''
            _body = re.sub(r'<[^>]+>', ' ', _ah)
        except Exception:
            dt = date + 'T09:00:00+09:00'
        # 관련성: 제목 또는 본문에 주제 키워드가 있어야 수집(제목만으로 놓치던 기사 보완, 일반뉴스 제외)
        if not (any(k in it['title'] for k in TOPIC) or any(k in _body for k in TOPIC)):
            continue
        img = download(it['idxno'], it['thumb'] or ogimg)
        entry = {'date': date, 'dt': dt, 'disp': disp, 'title': it['title'],
                 'url': '%s/news/articleView.html?idxno=%s' % (BASE, it['idxno']),
                 'img': img or 'img/ko_cokr%s.jpg' % it['idxno']}
        ko.insert(0, entry)
        added += 1
        print('추가:', it['idxno'], it['date'], it['title'][:40])

    ko.sort(key=lambda x: x.get('dt') or x.get('date', ''), reverse=True)
    json.dump(ko, open(KO, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('ko 갱신 완료. 신규 %d건, 총 %d건' % (added, len(ko)))


if __name__ == '__main__':
    main()

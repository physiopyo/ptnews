# -*- coding: utf-8 -*-
"""보험사 비리·문제 뉴스 자동 수집 → _news/insure.json
fetch_press의 수집 함수(구글RSS/네이버/insane/OG) 재사용.
채택 기준: 보험사(carrier) + 문제어(issue)가 제목+본문에 동시 존재.
"""
import os, sys, json, hashlib
from datetime import datetime, timedelta
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_press as fp

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
INSURE = os.path.join(HERE, 'insure.json')
IMGDIR = fp.IMGDIR
# 주요 보험사 상호(생명/손해) — 회사명만 노출된 기사도 게이트·검색에서 잡기 위함
INSURERS = ('삼성생명', '한화생명', '교보생명', '신한라이프', 'NH농협생명', '농협생명', '미래에셋생명',
            '동양생명', 'KB라이프', '흥국생명', '라이나생명', 'AIA생명', '메트라이프', 'ABL생명',
            '푸본현대생명', 'DB생명', 'iM라이프', '하나생명',
            '삼성화재', '현대해상', 'DB손해보험', 'DB손보', 'KB손해보험', 'KB손보', '메리츠화재',
            '한화손해보험', '한화손보', '롯데손해보험', '롯데손보', '흥국화재', 'MG손해보험',
            'AXA손해보험', '악사손해보험', '하나손해보험', '캐롯손해보험', '카카오페이손해보험',
            '신한EZ손해보험', 'NH농협손해보험', 'NH손보', '농협손해보험', '서울보증보험', 'SGI서울보증', '코리안리')
# 뉴스량·분쟁 많은 상위 보험사 → 회사별 검색 쿼리 자동 생성용
TOP_INSURERS = ('삼성생명', '한화생명', '교보생명', '신한라이프', '농협생명',
                '삼성화재', '현대해상', 'DB손해보험', 'KB손해보험', '메리츠화재', '롯데손해보험')

GQUERIES = ['실손보험 보험금 부지급', '보험사 보험금 지급 거부', '보험사 의료자문 보험금',
            '보험사 갑질', '보험사 제재 금융감독원', '보험사 과징금', '보험사 보험사기 적발',
            '실손보험 손해율 폭리', '실손보험 적자 영업이익', '보험사 약관 분쟁',
            '백내장 실손보험 분쟁', '도수치료 실손보험 보험사', '보험금 삭감 소송',
            '보험사 불완전판매', '보험사 횡포 소비자', '실손보험 보험사 논란']
NQUERIES = ['실손보험 부지급', '보험사 제재', '보험금 지급 거부', '보험사 갑질',
            '의료자문 보험금', '실손보험 손해율']
# 회사별 능동 수집: 상위 보험사 × 보험금 분쟁/부지급
GQUERIES = GQUERIES + [c + ' 보험금 분쟁' for c in TOP_INSURERS]
NQUERIES = NQUERIES + [c + ' 보험금 부지급' for c in TOP_INSURERS[:6]]
# 실적·부지급률 지표화로 인한 부당 지급거절·삭감, 설계사 실적압박
GQUERIES = GQUERIES + ['보험금 부지급률 실적', '손해사정 보험금 삭감', '보험설계사 실적 압박 갑질', '보험사 절판마케팅', '보험금 지급심사 성과급']
NQUERIES = NQUERIES + ['보험금 부지급률', '손해사정 삭감']
GWHEN = os.environ.get('INS_GWHEN', 'when:7d')   # 운영=최근 7일 신규. 백필 시 INS_GWHEN=when:30d
INS_DAYS = int(os.environ.get('INS_DAYS', '7'))  # 네이버 최근 N일
MAX_NEW = 90
MAX_TOTAL = 130

CARRIER = ('보험사', '보험회사', '실손보험', '실손', '손해보험', '생명보험', '보험금', '보험업계', '손보사', '생보사') + INSURERS
HARM = ('의료자문', '부지급', '부지급률', '지급 거부', '지급거부', '지급 거절', '지급거절', '거절', '거부',
        '안 주', '안주', '안 줘', '안줘', '못 받', '못 믿', '면책', '약관', '횡포', '갑질', '셀프 자문',
        '정보유출', '부당승환', '불인정', '책임 묻', '책임 강화', '제재', '징계', '과징금', '경고',
        '분쟁', '가혹', '반복청구', '심사기준', '함정', '삭감', '절판', '실적 압박')
# 제외: 보험사기(소비자/요양병원/자동차)·실손적자손해율(친정책 프레임)·시술기준(메인피드 중복)
# 친정책/엄살 재무 프레임(실손 적자·손해율 등) — 항상 제외
EX_FINANCE = ('적자', '손해율', '줄줄', '샜다', '거품', '17조', '뇌관', '보험료 폭탄', '보험료 또 오', '금리 오르면', '호재')
# 항상 제외: 친정책 euphemism·PR·경영·off-topic
EX_OFF = ('미용주사', '풍선효과', '로봇수술', '영양제', '위기의 손보사', '이대로는 안된', '정상화', '근골격계 보험금이 암',
          '수혜', '매각', '인수합병', '딜레마', '투명 공개', '관행 깬', '경고등', '보상관리 강화', '과실비율', '수익성 경고')
EX_FRAUD_CTX = ('자동차', '렌터카', '요양병원', '포상금', '편취', '고의 교통', '9조', '1.1조', 'AI',
                '잡는다', '방지')


def _excluded(t):
    if '체외충격파' in t:
        return True
    if ('도수치료' in t) and any(w in t for w in ('기준', '줄어')):
        return True
    if any(w in t for w in EX_OFF):
        return True
    if any(w in t for w in EX_FINANCE):
        return True
    if '기각' not in t:
        if '보험사기' in t:
            return True
        if ('사기' in t) and any(w in t for w in EX_FRAUD_CTX):
            return True
    if ('반환' in t or '돌려' in t) and any(w in t for w in ('티눈', '챙기', '굳은살')):
        return True
    if any(y in t for y in ('[2017', '[2018', '[2019', '[2020', '[2021', '[2022', '[2023', '[2024')):
        return True  # 과거연도 태그(예: '[2022 국감]') = 오래된 기사 제외
    if ('대인접수' in t) and not any(h in t for h in ('갑질', '부지급', '셀프', '제재', '과징금')):
        return True  # 대인접수 절차안내만 제외; 보험사 갑질·부지급이면 자동차라도 채택
    return False


def gate(ftitle, hay):
    if _excluded(ftitle):
        return False
    if not any(c in hay for c in CARRIER):
        return False
    if any(h in hay for h in HARM):
        return True
    return False


def imgname(key):
    return 'in_a' + hashlib.md5(key.encode('utf-8')).hexdigest()[:10] + '.jpg'


def main():
    import requests
    insure = json.load(open(INSURE, encoding='utf-8')) if os.path.exists(INSURE) else []
    have = set(fp.urlkey(it['url']) for it in insure)
    have_tk = set(fp.titlekey(it.get('title', '')) for it in insure)
    os.makedirs(IMGDIR, exist_ok=True)
    sess = requests.Session(); sess.headers.update(fp.H)
    cand = {}

    fp.GWHEN = GWHEN   # fp.gnews_rss가 참조하는 전역 윈도우 30일로 오버라이드

    # 1) 구글 뉴스 RSS
    for q in GQUERIES:
        for item in fp.gnews_rss(q):
            rt = fp.clean_title(item['rawtitle'])
            if len(rt) < 10 or not any(c in rt for c in CARRIER):
                continue
            if any(b in rt for b in fp.AD_BLOCK):
                continue
            tk = fp.titlekey(rt)
            if tk in have_tk:
                continue
            real = fp.decode_gnews(sess, item['glink'])
            if not real:
                continue
            host = urlparse(real).netloc.replace('www.', '')
            if any(b in host for b in fp.BLOCK_HOST):
                continue
            k = fp.urlkey(real)
            if k in have or k in cand:
                continue
            d, dt = fp.parse_pub(item['pub'])
            cand[k] = {'title': rt, 'url': real, 'chip': fp.chip_name(item['media'], host), 'date': d, 'dt': dt}
            have_tk.add(tk)

    # 2) 네이버 보조
    today = datetime.now()
    ds = (today - timedelta(days=INS_DAYS)).strftime('%Y.%m.%d')
    de = today.strftime('%Y.%m.%d')
    for q in NQUERIES:
        for pg in range(2):
            for k, (title, url) in fp.parse_naver(fp.naver_serp(q, ds, de, 1 + pg * 10)).items():
                if k in have or k in cand:
                    continue
                rt = fp.clean_title(title)
                if not any(c in rt for c in CARRIER) or any(b in rt for b in fp.AD_BLOCK):
                    continue
                tk = fp.titlekey(rt)
                if tk in have_tk:
                    continue
                host = urlparse(url).netloc.replace('www.', '')
                if any(b in host for b in fp.BLOCK_HOST):
                    continue
                cand[k] = {'title': rt, 'url': url, 'chip': '', 'date': None, 'dt': None}
                have_tk.add(tk)

    # 3) insane-search 보강
    for q in NQUERIES:
        for k, (title, url) in fp.insane_naver(q, ds, de).items():
            if k in have or k in cand:
                continue
            rt = fp.clean_title(title)
            if not any(c in rt for c in CARRIER) or any(b in rt for b in fp.AD_BLOCK):
                continue
            tk = fp.titlekey(rt)
            if tk in have_tk:
                continue
            host = urlparse(url).netloc.replace('www.', '')
            if any(b in host for b in fp.BLOCK_HOST):
                continue
            cand[k] = {'title': rt, 'url': url, 'chip': '', 'date': None, 'dt': None}
            have_tk.add(tk)

    # 후보 → OG 보강 후 게이트(보험사+문제어)
    added = 0
    for k, c in cand.items():
        if added >= MAX_NEW:
            break
        meta = fp.fetch_meta(sess, c['url']) or {}
        host = urlparse(c['url']).netloc.replace('www.', '')
        date = c.get('date') or meta.get('date') or today.strftime('%Y-%m-%d')
        dt = c.get('dt') or (date + 'T09:00:00+09:00')
        ftitle = fp.best_title(meta.get('title'), meta.get('ptitle'), c['title'])
        if not ftitle:
            continue
        hay = ftitle + ' ' + (meta.get('desc') or '') + ' ' + c['title']
        if not gate(ftitle, hay):
            continue
        if any(pw in ftitle for pw in fp.POL_BLOCK) and not any(cc in ftitle for cc in CARRIER):
            continue
        img_rel = ''
        if meta.get('img'):
            fn = imgname(k)
            if fp.dl_img(sess, meta['img'], os.path.join(IMGDIR, fn), c['url']):
                img_rel = 'img/' + fn
        chip = c.get('chip') or fp.chip_name(meta.get('site'), host)
        insure.append({
            'date': date, 'dt': dt, 'disp': date[2:].replace('-', '.'),
            'chip': chip, 'title': ftitle, 'url': c['url'], 'img': img_rel,
            'desc': meta.get('desc') or '',
        })
        have.add(k)
        added += 1

    insure.sort(key=lambda x: x.get('dt') or x.get('date', ''), reverse=True)
    if len(insure) > MAX_TOTAL:
        insure = insure[:MAX_TOTAL]
    json.dump(insure, open(INSURE, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('insure total=%d, added=%d' % (len(insure), added))


if __name__ == '__main__':
    main()

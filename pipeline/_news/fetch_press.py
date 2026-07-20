# -*- coding: utf-8 -*-
"""언론 보도 자동 수집 → _news/press.json
- 1차: 구글 뉴스 RSS(news.google.com/rss, ko/KR) — 광범위 집계, 매체명 정확
       RSS 링크(구글 리다이렉트) → batchexecute 디코드 → 실제 기사 URL
- 2차(보조): 네이버 뉴스 검색 — 구글 누락분 보강
- 신규만 OG 썸네일 다운로드 + 매체명 + 날짜, 중복(urlkey/제목) 제거
- 광고성(성형/할인 등)·비뉴스(SNS) 제외, 도수치료/관리급여/체외충격파 등 주제만
"""
import requests, re, json, os, sys, hashlib, html, time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse, parse_qs, quote
from xml.etree import ElementTree as ET
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PRESS = os.path.join(HERE, 'press.json')
IMGDIR = os.path.join(ROOT, '웹', 'board', 'img')

H = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9',
}

# 구글 뉴스 RSS 검색어(광범위) + 네이버 보조 검색어
GQUERIES = ['도수치료 관리급여', '도수치료', '물리치료사 관리급여', '체외충격파 실손',
            '체외충격파 관리급여', '도수치료 비급여', '도수치료 물리치료사',
            '도수치료 집회', '도수치료 궐기대회', '물리치료사 집회', '물리치료사 궐기대회',
            '물리치료사 총궐기', '관리급여 궐기대회', '관리급여 규탄', '도수치료 시위',
            '의사 궐기대회 관리급여', '도수치료 반대', '도수치료 관리급여 반대']
NQUERIES = ['도수치료 관리급여', '도수치료 관리급여화', '체외충격파 관리급여',
            '물리치료사 총궐기대회', '도수치료 궐기대회', '관리급여 반대 집회', '도수치료 집회']
GWHEN = 'when:4d'   # 구글 RSS 최근 N일
DAYS = 8            # 네이버 최근 N일
MAX_NEW = 120       # 1회 실행 신규 상한
MAX_TOTAL = 280     # press.json 누적 상한

KW = ('도수치료', '관리급여', '체외충격파', '물리치료', '비급여')
AD_BLOCK = ('성형', '할인', '이벤트', '쿠폰', '특가', '프로모션', '제휴', '다이어트', '광고', '클리닉 추천')
BLOCK_HOST = ('x.com', 'twitter.com', 'facebook.com', 'youtube.com', 'youtu.be',
              'instagram.com', 'blog.naver.com', 'cafe.naver.com', 'tistory.com', 'brunch.co.kr', 'supple.kr',
              'inven.co.kr', 'knpp.co.kr')
TOPIC = ('도수치료', '관리급여', '체외충격파', '물리치료', '증식치료', '비급여', '실손')
# 후보 수집은 넓게 하되 최종 채택은 아래 DIRECT_TITLE/ARTICLE_DESC_CORE로 엄격하게 판정한다.
RELAX = ('도수치료', '관리급여', '체외충격파', '물리치료', '비급여', '척추', '협착',
         '재활', '실손', '수기', '도수', '물치', '관절', '디스크', '근골격', '증식치료')
DIRECT_TITLE = ('도수치료', '관리급여', '체외충격파', '물리치료사', '물리치료',
                '도수재활', '증식치료', '도수의학')
ARTICLE_DESC_CORE = DIRECT_TITLE
POLICY_CONTEXT = ('관리급여', '급여화', '비급여', '실손', '보험', '보건복지부', '복지부', '수가',
                  '본인부담', '치료권', '환자 부담', '국회', '정책', '제도', '개편', '시행',
                  '철회', '반대', '집회', '궐기', '고용', '해고', '권고사직', '협회')
OPTICAL_BLOCK = ('안경', '렌즈', '시력')
BAD_PAGE_TITLE = ('Attention Required!', 'Access Denied', 'Just a moment...')
# 정치 기사 차단: 제목에 정치 신호어가 있고 의료 핵심 주제어가 전혀 없으면 제외
POL_BLOCK = ('국민의힘', '더불어민주당', '민주당', '정의당', '조국혁신당', '의회 독재', '기강확립', '당대표', '원내대표', '탄핵', '대선', '총선', '개헌', '특검', '내란', '정점식', '장동혁')
HAIR_ANCHOR = ('관리급여', '도수치료', '체외충격파', '근골격', '과잉진료', '비급여', '물리치료')  # '탈모' 제목은 이 정책어가 함께 있어야 채택(없으면 off-topic으로 제외)

# 시위·집회 기사: 같은 사안이라도 매체별 현장 보도는 버리지 않고 모두 수집(제목중복 제외에서 면제)
PROTEST_RE = ('총궐기', '궐기대회', '궐기', '집회', '거리로', '규탄', '결의대회', '시위', '집결', '손피켓', '촛불')
def is_protest(t):
    t = t or ''
    return any(w in t for w in PROTEST_RE)
# 브리핑·일정 등 오프토픽: 제목에 핵심주제어 없으면 제외(반도체/증시/정부일정 등 혼입 차단)
BRIEF_BLOCK = ('브리핑', '주요일정', '주간 일정', '주간일정', '헤드라인', '핵심 정리')

DOMAIN_MAP = {
 'rapportian.com': '라포르시안', 'doctorsnews.co.kr': '의협신문', 'dailymedi.com': '데일리메디',
 'monews.co.kr': '메디칼옵저버', 'docdocdoc.co.kr': '청년의사', 'medicaltimes.com': '메디칼타임즈',
 'bosa.co.kr': '의학신문', 'kukinews.com': '쿠키뉴스', 'news1.kr': '뉴스1', 'newsis.com': '뉴시스',
 'yna.co.kr': '연합뉴스', 'mdtoday.co.kr': '메디컬투데이', 'dailypharm.com': '데일리팜',
 'akomnews.com': '한의신문', 'consumernews.co.kr': '소비자가만드는신문', 'newspim.com': '뉴스핌',
 'mt.co.kr': '머니투데이', 'mk.co.kr': '매일경제', 'sbs.co.kr': 'SBS', 'imnews.imbc.com': 'MBC',
 'medigatenews.com': '메디게이트뉴스', 'bokuennews.com': '보건뉴스', 'pharmnews.com': '팜뉴스',
 'segyebiz.com': '세계비즈', 'segye.com': '세계일보', 'wowtv.co.kr': '한국경제TV',
 'busan.com': '부산일보', 'sedaily.com': '서울경제', 'asiae.co.kr': '아시아경제',
 'newdaily.co.kr': '뉴데일리', 'whosaeng.com': '후생신보', 'dt.co.kr': '디지털타임스',
 'sisajournal.com': '시사저널', 'dailian.co.kr': '데일리안', 'medipana.com': '메디파나뉴스',
 'kormedi.com': '코메디닷컴', 'hankyung.com': '한국경제', 'fnnews.com': '파이낸셜뉴스',
 'edaily.co.kr': '이데일리', 'health.chosun.com': '헬스조선', 'chosun.com': '조선일보',
 'donga.com': '동아일보', 'khan.co.kr': '경향신문', 'hani.co.kr': '한겨레',
 'joseilbo.com': '조세일보', 'kgnews.co.kr': '경기신문', 'etnews.com': '전자신문',
 'dentalnews.or.kr': '치과신문', 'kpanews.co.kr': '약사공론', 'ebn.co.kr': 'EBN',
 'gukjenews.com': '국제뉴스', 'ntoday.co.kr': '뉴스투데이', 'ilyo.co.kr': '일요신문',
 'pmnews.co.kr': '팍스메디컬뉴스', 'koreatimes.co.kr': '코리아타임스', 'ohmynews.com': '오마이뉴스',
 'medicaldaily.co.kr': '의약일보', 'hitnews.co.kr': '히트뉴스', 'medifonews.com': '메디포뉴스',
 'medipana.com': '메디파나뉴스', 'bokjenews.com': '복지뉴스', 'epharm.co.kr': '약업신문',
 'intn.co.kr': '인터넷신문', 'economicsignal.co.kr': '이코노믹시그널', 'hdnews.co.kr': '에이치디경제뉴스',
 '2news.co.kr': '투데이신문', 'v.daum.net': '다음뉴스', 'n.news.naver.com': '네이버뉴스',
}


def clean_title(t):
    t = html.unescape((t or '').strip()).lstrip('\ufeff\u200b ')
    t = re.sub(r'^(MEDI:?GATE NEWS|MEDIGATE NEWS|메디게이트뉴스)\s+', '', t, flags=re.I)
    # 선행 깨진문자/불릿 제거
    t = re.sub(r'^[\uFFFD?▶●■◆·\s]+', '', t)
    # 세로줄류 문자( ㅣU+3163, ｜U+FF5C, │U+2502, ∣U+2223 )를 파이프로 정규화
    t = re.sub(r'[\u3163\uFF5C\u2502\u2223]', '|', t)
    # 선행 매체명 접두 제거 (예: "중도일보 - ...", "OOO뉴스 | ...")
    t = re.sub(r'^[가-힣A-Za-z0-9.]{1,12}?(?:뉴스|신문|일보|경제신문|타임스|타임즈|투데이|미디어|데일리|저널)\s*[-|:‹]\s*', '', t).strip()
    # 링크 접근성 문구 '새 창 열림' 제거
    t = re.sub(r'\s*새\s*창\s*열림\s*$', '', t).strip()
    # 끝단 사이트명/섹션 접미 반복 제거 (구분자 - : | ‹ < · 뒤 짧은 꼬리)
    _PT = ('네이트 뉴스', '네이트뉴스', '네이트', '다음 뉴스', '다음뉴스', '다음', '네이버 뉴스', '네이버뉴스', '네이버', 'Nate', 'Daum', 'NAVER')
    _SC = ('사회', '경제', '정치', '종합', '국제', '문화', '스포츠', 'IT/과학', '건강', '오피니언', '생활', '연예')
    prev = None
    while prev != t:
        prev = t
        m = re.search(r'^(.{10,}?)\s*[-:|‹<>·]\s*([^-:|‹<>·]{1,24})\s*$', t)
        if not m:
            break
        tail = m.group(2).strip()
        if (tail in _PT or tail in _SC
                or re.search(r'(뉴스\d*|신문|일보|경제|타임스|타임즈|투데이|방송|미디어|닷컴|저널|데일리|헬스|메디|뉴시스|헬스조선|Biz|Pn)$', tail)
                or re.match(r'^[A-Za-z0-9][\w.\- ]*\.(co\.kr|com|net|kr|org)$', tail)
                or re.match(r'^[A-Za-z0-9.\-]+$', tail)):
            t = m.group(1).strip()
        else:
            break
    # 남은 끝단 구분자/파이프 제거
    t = re.sub(r'[\s|:·\-‹<>]+$', '', t).strip()
    return t


def chip_name(site, host):
    h = (host or '').replace('www.', '')
    if h in DOMAIN_MAP:
        return DOMAIN_MAP[h]
    s = (site or '').strip()
    if s and len(s) <= 14 and '…' not in s and not any(k in s for k in ('도수', '관리급여', '체외충격파')):
        # 소스가 도메인꼴이면 매핑/정리
        if re.match(r'^[\w.-]+\.\w{2,}$', s):
            return DOMAIN_MAP.get(s.replace('www.', ''), s)
        return s
    return DOMAIN_MAP.get(h, h)

# 포털(네이트·다음·네이버)은 매체가 아니라 플랫폼 → 실제 언론사를 바이라인/메타에서 추출
PORTAL_HOST = ('nate.com', 'daum.net', 'naver.com')
PORTAL_NAME = ('네이트', '네이트뉴스', '네이트 뉴스', '다음', '다음뉴스', '네이버', '네이버뉴스', 'Daum', 'Nate', 'NAVER', 'NATE')
def is_portal(host):
    h = (host or '').replace('www.', '')
    return any(p in h for p in PORTAL_HOST)
def outlet_from_text(t):
    t = t or ''
    m = re.search(r'[\(\[][가-힣A-Za-z]{1,8}=\s*([가-힣A-Za-z0-9·]{2,14})[\)\]]', t)
    if m and m.group(1).strip() not in PORTAL_NAME:
        return m.group(1).strip()
    m = re.search(r'\[\s*([가-힣A-Za-z0-9·]{2,12}?(?:뉴스|신문|일보|타임스|타임즈|투데이|경제|방송|미디어|닷컴|저널))', t)
    if m and m.group(1).strip() not in PORTAL_NAME:
        return m.group(1).strip()
    return ''
def outlet_from_html(t):
    t = t or ''
    # 네이트: .medium 요소(원 매체명)
    m = re.search(r'class=["\']medium["\'][^>]*>(.*?)</(?:a|span|div|p)>', t, re.S)
    if m:
        s = html.unescape(re.sub(r'<[^>]+>', '', m.group(1))).strip()
        if s and len(s) <= 16 and s not in PORTAL_NAME and not any(k in s for k in ('도수', '관리급여', '체외충격파')):
            return DOMAIN_MAP.get(s, s)
    # 저작권 ⓒ 라인
    for pat in (r'저작권자\s*[ⓒ©Ⓒ]\s*\(?\s*([가-힣A-Za-z][가-힣A-Za-z·]{1,12})',
                r'[ⓒ©Ⓒ]\s*([가-힣A-Za-z][가-힣A-Za-z·]{1,12})\s*(?:&|[\(（]?\s*(?:www|http|\.))',
                r'([가-힣A-Za-z][가-힣A-Za-z·]{1,12})\s*[\(（]\s*(?:www|http)'):
        m = re.search(pat, t)
        if m:
            s = m.group(1).strip()
            if s and s not in PORTAL_NAME and not any(k in s for k in ('도수', '관리급여', '체외충격파')):
                return DOMAIN_MAP.get(s, s)
    # 다음/네이트: 'Daum | 매체 | 제목' 타이틀형
    m = re.search(r'(?:Daum|Nate|다음|네이트)\s*\|\s*([가-힣A-Za-z0-9·\s]{2,16}?)\s*\|', t)
    if m and m.group(1).strip() not in PORTAL_NAME:
        return m.group(1).strip()
    return ''
def resolve_chip(host, site, desc='', title=''):
    base = chip_name(site, host)
    if is_portal(host) or base in PORTAL_NAME:
        real = outlet_from_text(desc) or outlet_from_text(title)
        if not real and site and site.strip() not in PORTAL_NAME:
            real = site.strip()
        if real:
            return DOMAIN_MAP.get(real, real)
    return base


def urlkey(u):
    p = urlparse(html.unescape(u or ''))
    host = p.netloc.replace('www.', '')
    if host == 'm.news.nate.com':
        host = 'news.nate.com'
    qs = parse_qs(p.query)
    for idk in ('idxno', 'wr_id', 'aid', 'articleId', 'no', 'artid', 'art_id', 'contid', 'idx'):
        if idk in qs:
            return host + '#' + qs[idk][0]
    return host + p.path.rstrip('/')


def titlekey(t):
    return re.sub(r'[^0-9가-힣a-zA-Z]', '', t or '')

def is_relevant_article(title, desc='', url=''):
    """치료 소개·병원 홍보가 아니라 PT뉴스의 정책 의제를 직접 다루는 기사만 허용한다."""
    title = clean_title(title)
    desc = re.sub(r'\s+', ' ', desc or '').strip()
    host = urlparse(html.unescape(url or '')).netloc.replace('www.', '')
    if any(blocked in host for blocked in BLOCK_HOST):
        return False
    if not title or title in BAD_PAGE_TITLE:
        return False
    if title.startswith('[') and ']' not in title:
        return False

    if any(term in title for term in ('퍼포먼스 의료', '새로운 패러다임', '장비 도입', '시술 바로알기')):
        return False
    if '관리급여' in title:
        return True
    if ('도수치료' in title or '도수재활' in title or '도수의학' in title):
        return any(term in title for term in POLICY_CONTEXT)
    if '물리치료사' in title or '물리치료' in title:
        return any(term in title for term in POLICY_CONTEXT)
    if '체외충격파' in title or '증식치료' in title:
        return any(term in title for term in ('관리급여', '급여화', '비급여', '실손', '보험', '정책', '제도', '본인부담'))
    return False


def imgname(key):
    return 'pr_a' + hashlib.md5(key.encode('utf-8')).hexdigest()[:10] + '.jpg'


# ---------- 구글 뉴스 RSS ----------
def gnews_rss(query):
    u = 'https://news.google.com/rss/search?q=%s&hl=ko&gl=KR&ceid=KR:ko' % quote(query + ' ' + GWHEN)
    try:
        time.sleep(0.5)
        r = requests.get(u, headers=H, timeout=20)
        root = ET.fromstring(r.content)
    except Exception:
        return []
    out = []
    for it in root.iter('item'):
        title = (it.findtext('title') or '').strip()
        link = (it.findtext('link') or '').strip()
        pub = (it.findtext('pubDate') or '').strip()
        src = it.find('source')
        media = (src.text if src is not None and src.text else '')
        if '/articles/' not in link:
            continue
        out.append({'rawtitle': title, 'glink': link, 'pub': pub, 'media': media})
    return out


def decode_gnews(sess, glink):
    """구글 뉴스 RSS 리다이렉트 → 실제 기사 URL (batchexecute)."""
    try:
        aid = glink.split('/articles/')[1].split('?')[0]
    except Exception:
        return None
    try:
        time.sleep(0.3)
        r = sess.get('https://news.google.com/rss/articles/%s' % aid, timeout=20)
        sg = re.search(r'data-n-a-sg="([^"]+)"', r.text)
        ts = re.search(r'data-n-a-ts="([^"]+)"', r.text)
        if not (sg and ts):
            return None
        inner = json.dumps(["garturlreq", [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None, None, None, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0], aid, int(ts.group(1)), sg.group(1)])
        freq = json.dumps([[["Fbv4je", inner]]])
        rr = sess.post('https://news.google.com/_/DotsSplashUi/data/batchexecute',
                       data={'f.req': freq},
                       headers={'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'}, timeout=20)
        raw = rr.text
        for line in raw.split('\n'):
            line = line.strip()
            if not line.startswith('[['):
                continue
            try:
                outer = json.loads(line)
            except Exception:
                continue
            for item in outer:
                if isinstance(item, list) and len(item) > 2 and item[0] == 'wrb.fr' and item[2]:
                    try:
                        real = json.loads(item[2])[1]
                        if real and real.startswith('http'):
                            return real
                    except Exception:
                        pass
        return None
    except Exception:
        return None


def parse_pub(pub):
    try:
        dt = parsedate_to_datetime(pub)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        kst = dt.astimezone(timezone(timedelta(hours=9)))
        return kst.strftime('%Y-%m-%d'), kst.strftime('%Y-%m-%dT%H:%M:%S+09:00')
    except Exception:
        return None, None


# ---------- 네이버 뉴스(보조) ----------
def naver_serp(query, ds, de, start):
    u = ('https://search.naver.com/search.naver?where=news&query=%s&sort=1&pd=3&ds=%s&de=%s&start=%d'
         % (quote(query), ds, de, start))
    try:
        time.sleep(0.6)
        return requests.get(u, headers=H, timeout=20).text
    except Exception:
        return ''


def parse_naver(t):
    out = {}
    for m in re.finditer(r'<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>', t, re.S):
        href = m.group(1)
        txt = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', m.group(2)))).strip()
        if len(txt) < 12 or not any(k in txt for k in RELAX):
            continue
        host = urlparse(href).netloc
        if 'naver.com' in host or 'search.naver' in href:
            continue
        k = urlkey(href)
        if k not in out:
            out[k] = (txt, href.split('#')[0])
    return out


# ---------- insane-search 엔진(옵션·3차 보강) ----------
try:
    sys.path.insert(0, r"C:\Users\wndud\.codex\plugins\cache\gptaku-codex\insane-search-codex\0.8.2\skills\insane-search")
    from engine import fetch as _isfetch
    from bs4 import BeautifulSoup as _BS
    HAS_INSANE = True
except Exception:
    HAS_INSANE = False


def insane_naver(query, ds, de):
    if not HAS_INSANE:
        return {}
    u = ('https://search.naver.com/search.naver?where=news&query=%s&sort=1&pd=3&ds=%s&de=%s&start=1'
         % (quote(query), ds, de))
    out = {}
    try:
        r = _isfetch(u, timeout=30)
        raw = r.content
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode('utf-8', 'replace')
        soup = _BS(raw, 'html.parser')
        for a in soup.select('a.news_tit'):
            t = a.get_text(' ', strip=True)
            href = a.get('href', '')
            if len(t) < 12 or not any(k in t for k in RELAX):
                continue
            if 'naver.com' in urlparse(href).netloc:
                continue
            k = urlkey(href)
            if k not in out:
                out[k] = (t, href.split('#')[0])
    except Exception:
        pass
    return out


# ---------- OG 메타/이미지 ----------
def fetch_meta(sess, url):
    try:
        time.sleep(0.3)
        r = sess.get(url, headers={**H, 'Referer': 'https://news.google.com/'}, timeout=15)
        enc = None
        m = re.search(r'charset=["\']?([\w\-]+)', r.headers.get('Content-Type', ''), re.I)
        if m:
            enc = m.group(1)
        if not enc:
            mm = re.search(rb'<meta[^>]+charset=["\']?([\w\-]+)', r.content[:3000], re.I)
            if mm:
                enc = mm.group(1).decode('ascii', 'ignore')
        if enc:
            try:
                r.encoding = enc
            except Exception:
                pass
        elif (r.encoding or '').lower() in ('iso-8859-1', 'latin-1', ''):
            r.encoding = r.apparent_encoding or 'utf-8'
        t = r.text
    except Exception:
        return None

    def og(prop):
        m = (re.search(r'<meta[^>]+property=["\']%s["\'][^>]+content=["\']([^"\']+)' % prop, t)
             or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']%s["\']' % prop, t))
        return html.unescape(m.group(1)) if m else None
    img = og('og:image')
    site = og('og:site_name')
    title = og('og:title')
    desc = og('og:description') or og('twitter:description')
    if not desc:
        md = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)', t)
        desc = html.unescape(md.group(1)) if md else None
    desc = re.sub(r'\s+', ' ', (desc or '')).strip()[:400]
    mtt = re.search(r'<title[^>]*>(.*?)</title>', t, re.S)
    ptitle = html.unescape(mtt.group(1)).strip() if mtt else None
    published = None
    for pat in (
            r'article:published_time["\'][^>]+content=["\']([^"\']+)',
            r'content=["\']([^"\']+)["\'][^>]+article:published_time',
            r'"datePublished"\s*:\s*"([^"]+)"',
            r'(?:datePublished|article_date|publish_date)["\'][^>]+content=["\']([^"\']+)'):
        mdt = re.search(pat, t, re.I)
        if mdt:
            published = html.unescape(mdt.group(1)).strip()
            break
    date = None
    dt = None
    if published:
        try:
            parsed = datetime.fromisoformat(published.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone(timedelta(hours=9)))
            kst = parsed.astimezone(timezone(timedelta(hours=9)))
            date = kst.strftime('%Y-%m-%d')
            dt = kst.strftime('%Y-%m-%dT%H:%M:%S+09:00')
        except ValueError:
            md = re.search(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})', published)
            if md:
                date = '%04d-%02d-%02d' % tuple(map(int, md.groups()))
                mt = re.search(r'[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?', published)
                if mt:
                    hh, mm, ss = int(mt.group(1)), int(mt.group(2)), int(mt.group(3) or 0)
                    dt = '%sT%02d:%02d:%02d+09:00' % (date, hh, mm, ss)
    if date and date < '2000-01-01':
        date = None
        dt = None
    press = ''
    try:
        _host = urlparse(url).netloc.replace('www.', '')
        if is_portal(_host):
            press = outlet_from_html(t)
    except Exception:
        press = ''
    return {'img': img, 'site': site, 'date': date, 'dt': dt, 'title': title, 'ptitle': ptitle, 'desc': desc, 'press': press}


def _looks_body(t):
    """검색 스니펫/본문이 제목으로 잘못 들어온 경우 탐지."""
    if not t:
        return True
    # 차단/오류 페이지 제목(수집 불가 페이지)
    if re.match(r'^\s*(Attention Required|Just a moment|Access Denied|403 Forbidden|404|Error|robot|captcha)', t, re.I):
        return True
    if '새 창 열림' in t or '새창열림' in t:
        return True
    if t.count('다.') >= 2:
        return True
    tt = t.rstrip()
    if len(tt) >= 58 and (tt.endswith('...') or tt.endswith('…')):
        return True
    return False


def best_title(otitle, ptitle, fallback):
    valid = []
    for cand in (otitle, ptitle, fallback):
        if not cand or _looks_body(cand):
            continue
        t = clean_title(re.split(r'\s+[<|‹]\s+', cand.strip())[0])
        if len(t) < 8:
            continue
        if re.match(r'^(뉴스|기사|보도|홈|main|index|home)$', t, re.I):
            continue
        if _looks_body(t):
            continue
        valid.append(t)
    # 일부 매체의 OG 제목은 앞부분만 잘려 있다. 유효 후보 중 가장 완전한 제목을 쓴다.
    return max(valid, key=len) if valid else None


def dl_img(sess, img_url, dest, referer):
    try:
        r = sess.get(img_url, headers={**H, 'Referer': referer}, timeout=20)
        if r.status_code == 200 and len(r.content) > 800:
            open(dest, 'wb').write(r.content)
            return True
    except Exception:
        pass
    return False


def main():
    press = json.load(open(PRESS, encoding='utf-8'))
    have = set(urlkey(it['url']) for it in press)
    have_tk = set(titlekey(it.get('title', '')) for it in press)
    # 고영준(ko.json) 채널과 크로스 중복 방지: 같은 제목이면 press에 안 담음(포털 재전송 포함)
    try:
        for _x in json.load(open(os.path.join(HERE, 'ko.json'), encoding='utf-8')):
            have_tk.add(titlekey(_x.get('title', '')))
    except Exception:
        pass
    os.makedirs(IMGDIR, exist_ok=True)
    sess = requests.Session(); sess.headers.update(H)

    # 후보 수집: {urlkey: {title, url, chip, date, dt}}
    cand = {}

    # 1) 구글 뉴스 RSS (광범위)
    for q in GQUERIES:
        for item in gnews_rss(q):
            rt = clean_title(item['rawtitle'])
            if len(rt) < 10 or not any(k in rt for k in RELAX):
                continue
            if any(b in rt for b in AD_BLOCK):
                continue
            tk = titlekey(rt)
            if tk in have_tk:
                continue  # 제목 완전 동일(같은 기사 신디케이션)만 중복 제거; 제목 다르면 모두 수집
            real = decode_gnews(sess, item['glink'])
            if not real:
                continue
            host = urlparse(real).netloc.replace('www.', '')
            if any(b in host for b in BLOCK_HOST):
                continue
            k = urlkey(real)
            if k in have or k in cand:
                continue
            d, dt = parse_pub(item['pub'])
            chip = resolve_chip(host, item['media'], '', rt)
            cand[k] = {'title': rt, 'url': real, 'chip': chip, 'date': d, 'dt': dt}
            have_tk.add(tk)

    # 2) 네이버 보조
    today = datetime.now()
    ds = (today - timedelta(days=DAYS)).strftime('%Y.%m.%d')
    de = today.strftime('%Y.%m.%d')
    for q in NQUERIES:
        for pg in range(2):
            for k, (title, url) in parse_naver(naver_serp(q, ds, de, 1 + pg * 10)).items():
                if k in have or k in cand:
                    continue
                rt = clean_title(title)
                if any(b in rt for b in AD_BLOCK):
                    continue
                tk = titlekey(rt)
                if tk in have_tk:
                    continue
                host = urlparse(url).netloc.replace('www.', '')
                if any(b in host for b in BLOCK_HOST):
                    continue
                cand[k] = {'title': rt, 'url': url, 'chip': '', 'date': None, 'dt': None}
                have_tk.add(tk)

    # 3) insane-search 엔진(네이버, 브라우저급 — 누락 보강)
    for q in NQUERIES:
        for k, (title, url) in insane_naver(q, ds, de).items():
            if k in have or k in cand:
                continue
            rt = clean_title(title)
            if any(b in rt for b in AD_BLOCK):
                continue
            tk = titlekey(rt)
            if tk in have_tk:
                continue
            host = urlparse(url).netloc.replace('www.', '')
            if any(b in host for b in BLOCK_HOST):
                continue
            cand[k] = {'title': rt, 'url': url, 'chip': '', 'date': None, 'dt': None}
            have_tk.add(tk)

    # 후보 → OG 보강 후 추가
    added = 0
    for k, c in cand.items():
        if added >= MAX_NEW:
            break
        meta = fetch_meta(sess, c['url']) or {}
        host = urlparse(c['url']).netloc.replace('www.', '')
        if host == 'seoulilbo.co.kr':
            continue  # 고영준 전용 채널에서 수집하므로 언론보도 채널 중복을 막는다.
        # 원문 메타가 있으면 검색포털/RSS 수집 시각보다 원문 발행일을 우선한다.
        date = meta.get('date') or c.get('date') or today.strftime('%Y-%m-%d')
        dt = meta.get('dt') or (c.get('dt') if c.get('date') == date else None) or (date + 'T09:00:00+09:00')
        if date < (today - timedelta(days=45)).strftime('%Y-%m-%d'):
            continue  # 검색엔진이 다시 띄운 오래된 기사를 신규 기사로 오인하지 않는다.
        ftitle = best_title(meta.get('title'), meta.get('ptitle'), c['title'])
        if not ftitle:
            continue
        if '탈모' in ftitle and not any(a in ftitle for a in HAIR_ANCHOR):
            continue
        if any(b in ftitle for b in BRIEF_BLOCK) and not any(c in ftitle for c in DIRECT_TITLE):
            continue
        desc = meta.get('desc') or ''
        if not is_relevant_article(ftitle, desc, c['url']):
            continue
        if any(pw in ftitle for pw in POL_BLOCK) and not any(tw in ftitle for tw in DIRECT_TITLE):
            continue
        img_rel = ''
        if meta.get('img'):
            fn = imgname(k)
            if dl_img(sess, meta['img'], os.path.join(IMGDIR, fn), c['url']):
                img_rel = 'img/' + fn
        # 매체 결정: 페이지 추출 원매체 > 비포털 후보chip > 바이라인/메타 > 포털 폴백
        cc = c.get('chip')
        chip = (meta.get('press')
                or (cc if cc and cc not in PORTAL_NAME else None)
                or resolve_chip(host, meta.get('site'), meta.get('desc'), c['title'])
                or cc)
        press.append({
            'date': date, 'dt': dt, 'disp': date[2:].replace('-', '.'),
            'chip': chip, 'title': ftitle, 'url': c['url'], 'img': img_rel,
            'desc': desc,
        })
        have.add(k)
        added += 1

    press.sort(key=lambda x: x.get('dt') or x.get('date', ''), reverse=True)
    # 과거 기사를 찾을 수 있도록 누적 데이터를 자르지 않는다.
    json.dump(press, open(PRESS, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('press total=%d, added=%d (구글RSS+네이버)' % (len(press), added))


if __name__ == '__main__':
    main()

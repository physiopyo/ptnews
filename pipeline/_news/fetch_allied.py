# -*- coding: utf-8 -*-
"""심리상담·약사 정책 뉴스. 누적 보존, 한도 있는 Google RSS/네이버 공식 API 수집."""
import argparse
import html
import json
import os
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from itertools import zip_longest
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree as ET

import requests
from buzz_config import CONFIG_HASH, SPECS
import hashlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fetch_press import BAD_PAGE_TITLE, H, IMGDIR, best_title, decode_gnews, dl_img, fetch_meta, parse_pub, resolve_chip

HERE = os.path.dirname(os.path.abspath(__file__))
REGULAR_DAYS = 4
MAX_DAYS = 31
# One-shot backfill only: the official news API serves start<=1000 (10 pages of 100).
BACKFILL_PAGES = 10
REGULAR_LIMITS = (160, 400)
BACKFILL_LIMITS = (8000, 4000)
# Google News RSS returns at most ~100 items per query, so backfills search week by week.
WINDOW_DAYS = 7
IMAGE_REPAIRS = (40, 800)
# Parallel workers: Google decode stays gentle (one host); article pages are spread across outlets.
DECODE_WORKERS = int(os.environ.get('ALLIED_DECODE_WORKERS', '2'))
PAGE_WORKERS = int(os.environ.get('ALLIED_PAGE_WORKERS', '6'))  # regular run / backfill: older rows missing a thumbnail
TOPICS = {
    'psych': ('심리 상담', '심리 상담사', '상담 심리사', '임상 심리사',
              '정신 건강 임상 심리사', '정신 건강 간호사', '정신 건강 사회 복지사',
              '정신 건강 작업 치료사', '정신 건강 전문 요원',
              '전 국민 마음 투자 지원 사업', '마음 투자 지원 사업',
              '전 국민 마음 건강',
              '정신 건강 심리 상담 바우처 사업', '심리 상담 바우처',
              '심리 상담사법', '정신 건강 복지법', '정신 건강 증진 및 정신 질환자 복지 서비스 지원에 관한 법률'),
    'pharm': ('약사', '약사회', '대한 약사회', '약국', '약사법', '조제',
              '성분명 처방', '성분명', '대체 조제', '의약 분업', '약 배송',
              '약 배달', '의약품 배송', '전자 처방전', '복약 지도', '품절 약', '품절 의약품',
              '공적 전자 처방전', '비대면 진료 플랫폼', '약국 플랫폼',
              '의약품 수급', '의약품 오남용', '의약품 오·남용', '공공 심야 약국'),
}
SEARCH_CONTEXT = {
    '비대면진료': '비대면진료 약국',
    '비대면진료 플랫폼': '비대면진료 플랫폼 약 배송',
    '전국민 마음건강': '전국민 마음건강 심리상담',
}
QUERY_EXTRAS = {
    'psych': ('심리상담사 법제화', '상담심리사 자격', '보건복지부 심리상담', '국립정신건강센터 정책'),
    'pharm': ('보건복지부 약사', '식약처 의약품 수급'),
}
QUERIES = {topic: tuple(dict.fromkeys(
    [SEARCH_CONTEXT.get(spec['keyword'], spec['keyword']) for spec in SPECS if spec['subject'] == topic]
    + list(QUERY_EXTRAS[topic]))) for topic in TOPICS}
POLICY = ('정책', '법안', '법제화', '입법', '국회', '면허', '자격', '제도', '보건복지부',
          '복지부', '보험', '수가', '급여', '직역', '업무', '처우', '고용', '인력', '협회',
          '약사회', '분쟁', '논란', '규제', '상담사법', '심리사법', '전문성', '안전', '수급',
          '품절', '비대면', '공공심야', '성분명', '대체조제', '의약분업', '돌봄', '지원사업',
          '바우처', '배송', '플랫폼', '조제', '처방전', '복약지도', '오남용', '시행령', '수련')
PROMO = ('할인', '쿠폰', '수강생 모집', '수강료', '무료수강', '무료 수강', '자격증 취득',
         '선착순', '특가', '구매', '개원 기념')
DEBATE = ('정책', '법안', '법제화', '입법', '국회', '논란', '규제', '불법', '민간자격',
          '국가자격', '직역', '제도', '수가', '급여', '분쟁', '업무범위', '수급', '오남용',
          '위반', '금지', '반대', '우려', '대책')
BLOCK_HOSTS = ('blog.naver.com', 'cafe.naver.com', 'youtube.com', 'youtu.be', 'instagram.com')
PARTICLES = ('에서는', '에게는', '으로는', '으로서', '로서', '으로', '로는', '와는', '과는',
             '에서도', '에게도', '에서', '에게', '까지', '부터', '처럼', '보다', '마다', '라도',
             '이란', '라는', '이자', '은', '는', '이', '가', '을', '를', '의', '도', '에',
             '와', '과', '로', '만', '랑')


def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', '', value or ''))).strip()


def term_pattern(term):
    body = r'\s*'.join(re.escape(part) for part in term.split())
    return re.compile(r'(?<![가-힣A-Za-z0-9_])' + body + r'(?:들)?(?:' +
                      '|'.join(PARTICLES) + r')?(?![가-힣A-Za-z0-9_])')


TOPIC_PATTERNS = {topic: tuple(term_pattern(term) for term in terms) for topic, terms in TOPICS.items()}
ORGANIZATIONS = tuple(term_pattern(term) for term in
                      ('국립 정신 건강 센터', '한국 심리 학회', '한국 상담 심리 학회',
                       '한국 임상 심리 학회', '한국 상담 학회', '한국 정신 건강 사회 복지사 협회'))
ORGANIZATION_POLICY = ('법안', '법제화', '입법', '정책', '자격', '수련', '업무범위', '직역', '바우처', '지원사업')
GENERAL_JOBS = tuple(term_pattern(term) for term in ('간호사', '사회 복지사', '작업 치료사'))
MENTAL_CONTEXT = tuple(term_pattern(term) for term in
                       ('정신 건강', '정신 보건', '정신 건강 복지 센터', '정신 보건 센터',
                        '심리 상담', '상담 정책', '상담 법제화', '상담 바우처'))


def url_key(url):
    """Preserve scheme, host and every article parameter; sort keys stably like URLSearchParams."""
    p = urlsplit(html.unescape(url or ''))
    host = (p.hostname or '').lower().removeprefix('www.').encode('idna').decode('ascii')
    if ':' in host:
        host = '[' + host + ']'
    port = p.port
    if port and (p.scheme.lower(), port) not in (('https', 443), ('http', 80)):
        host += ':' + str(port)
    query = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
             if not k.lower().startswith('utm_') and k.lower() not in ('fbclid', 'gclid')]
    query.sort(key=lambda pair: pair[0])
    encoded_query = urlencode(query).replace('~', '%7E').replace('%2A', '*')
    path = quote(p.path or '/', safe="/:@-._~!$&'()*+,;=%")
    return urlunsplit((p.scheme.lower(), host, path, encoded_query, ''))


# Issue focus: psych = 심리상담 공통업무화·정신건강전문요원/심리 자격 제도, pharm = 비대면 약 배송 등
#약사 직역 현안. A core term alone qualifies; a broad term needs an issue qualifier in the same text.
PSYCH_CORE = ('공통업무', '임상심리', '심리상담바우처', '심리바우처', '상담바우처', '마음투자', '정신건강전문요원', '정신건강임상심리사', '임상심리사', '상담심리사', '심리상담사법',
              '심리사법', '정신건강복지법시행령', '전문요원업무범위', '정신건강간호사', '정신건강사회복지사', '정신건강작업치료사')
# Associations count only with a policy qualifier (e.g. '학회 반발 … 공통업무'), not for MOUs or appointments.
PSYCH_BROAD = ('심리상담', '마음투자', '심리상담바우처', '임상심리학회', '상담심리학회', '심리학회', '상담학회')
PSYCH_QUALIFIER = ('반발', '성명', '반대', '자격', '법제화', '입법', '법안', '업무범위', '전문성', '수련', '직역', '국가자격',
                   '민간자격', '시행령', '공통업무', '누구의역할', '고유업무')
# Summary-only evidence must name the policy dispute itself, not merely mention a profession.
PSYCH_STRONG = ('공통업무', '업무범위', '고유업무', '시행령', '심리상담사법', '국가자격', '심리상담바우처',
                '마음투자')
PHARM_CORE = ('약배송', '약배달', '의약품배송', '비대면조제', '성분명처방', '대체조제', '공적전자처방',
              '전자처방전', '약사총궐기', '약사궐기', '약사결의대회', '약배송확대', '재택수령', '의약품수령')
PHARM_BROAD = ('비대면진료', '약사회', '약사', '약국', '약사법')
PHARM_QUALIFIER = ('비대면', '플랫폼', '성분명', '대체조제', '처방전', '궐기', '집회', '결의대회', '재택수령', '비대위')


# Education/training notices mention qualifications without being about the policy dispute.
PSYCH_NOT_ISSUE = ('자격연수', '연수', '자격증', '학과', '학점', '입학', '모집', '특강', 'Wee', '위센터', '위클래스')
NOT_PHARMACIST = ('제약사', '제약회사', '신약', '한약사')


def squeeze(text):
    return re.sub(r'[\s·ㆍ・\-]+', '', text)


def issue_topics(title, body):
    """Core term in the title qualifies. Otherwise the title must name the field (broad term or
    core term in the summary) and the article must carry an issue qualifier."""
    title, body = squeeze(title), squeeze(body)
    for word in NOT_PHARMACIST:
        title, body = title.replace(word, ' '), body.replace(word, ' ')
    text = title + ' ' + body
    topics = []
    notice = any(w in title for w in PSYCH_NOT_ISSUE)
    hints = {'psych': ('간호사', '사회복지사', '작업치료사'), 'pharm': ('약사', '약국', '의약품')}
    for topic, core, broad, qualifier in (('psych', PSYCH_CORE, PSYCH_BROAD, PSYCH_QUALIFIER),
                                          ('pharm', PHARM_CORE, PHARM_BROAD, PHARM_QUALIFIER)):
        titled = any(w in title for w in broad + qualifier + hints[topic])
        if (any(w in title for w in core)
                or (any(w in body for w in core) and titled
                    and (topic != 'psych' or any(w in body for w in PSYCH_STRONG)))
                or (any(w in title for w in broad) and any(w in title for w in qualifier))):
            if not (topic == 'psych' and notice and not any(
                    w in title for w in ('공통업무', '업무범위', '시행령', '논란', '난립', '규제', '법제화'))):
                topics.append(topic)
    if ('pharm' not in topics and ('배송' in title or '배달' in title)
            and any(w in title for w in ('약사', '약국', '의약품', '처방약'))
            and not any(w in title for w in ('광고', '차량'))):
        topics.append('pharm')
    return topics


def classify(title, description='', url=''):
    """Only article title/description; the text must be about the psych or pharm issue itself."""
    text = clean(title) + ' ' + clean(description)
    compact = squeeze(text)
    host = (urlsplit(url).hostname or '').lower()
    if not clean(title) or any(host == h or host.endswith('.' + h) for h in BLOCK_HOSTS):
        return []
    # Promotion words must start a word ('역할인가' is not '할인').
    promo = any(re.search(r'(?<![가-힣])' + re.escape(re.sub(r'\s+', '', w)), compact) for w in PROMO)
    if promo and not any(w in compact for w in DEBATE):
        return []
    return issue_topics(clean(title), clean(description))


def credentials_valid(credentials):
    return isinstance(credentials, dict) and all(isinstance(credentials.get(k), str) and credentials[k].strip()
                                                  for k in ('id', 'secret'))


class RequestBudget:
    """Count HTTP requests including redirects; stop rather than retry a rate-limited source."""
    def __init__(self, session, maximum, report):
        self.session, self.maximum, self.report = session, maximum, report
        self.source = 'google'
        self.blocked = set()
        self.count = 0
        self.lock = threading.Lock()
        report.update(requests=0, max_requests=maximum, sources={}, queries=[], candidates=[], stop_reason=None)

    def request(self, method, url, source=None, **kwargs):
        source = source or self.source
        status = self.report['sources'].setdefault(source, {'requests': 0, 'status': 'pending'})
        for _ in range(6):
            if self.count >= self.maximum or source in self.blocked:
                if self.count >= self.maximum:
                    self.report['stop_reason'] = 'request_budget'
                raise requests.RequestException('request budget or source backoff')
            with self.lock:
                if self.count >= self.maximum:
                    self.report['stop_reason'] = 'request_budget'
                    raise requests.RequestException('request budget')
                self.count += 1
                self.report['requests'] = self.count
                status['requests'] += 1
            try:
                response = getattr(self.session, method)(url, allow_redirects=False, **kwargs)
                code = response.status_code
                status['http_status'] = code
                if code in (429, 503):
                    self.blocked.add(source)
                    retry = response.headers.get('Retry-After', '')
                    status.update(status='rate_limited' if code == 429 else 'unavailable', http_status=code,
                                  retry_after=retry if re.fullmatch(r'\d{1,8}', str(retry)) else None,
                                  backoff='stop_for_run')
                response.raise_for_status()
                if code in (301, 302, 303, 307, 308):
                    target = urljoin(url, response.headers.get('Location', ''))
                    # The official API should not redirect; never forward its credentials.
                    if source == 'naver' or not response.headers.get('Location') or urlsplit(target).scheme not in ('http', 'https'):
                        raise requests.RequestException('unexpected redirect')
                    url = target
                    kwargs.pop('params', None)
                    if code == 303 or (code in (301, 302) and method == 'post'):
                        method = 'get'
                        kwargs.pop('data', None)
                    continue
                status['status'] = 'ok'
                return response
            except requests.RequestException:
                status['errors'] = status.get('errors', 0) + 1
                if status['status'] not in ('rate_limited', 'unavailable'):
                    status['status'] = 'error'
                raise
        status['status'] = 'redirect_limit'
        raise requests.RequestException('redirect limit')

    def for_source(self, source):
        budget = self

        class Scoped:
            def get(self, url, **kwargs):
                return budget.request('get', url, source=source, **kwargs)

            def post(self, url, **kwargs):
                return budget.request('post', url, source=source, **kwargs)
        return Scoped()

    def get(self, url, **kwargs):
        return self.request('get', url, **kwargs)

    def post(self, url, **kwargs):
        return self.request('post', url, **kwargs)


def gnews_rss(session, query, days=REGULAR_DAYS, window=None):
    # fetch_press.gnews_rss uses a separate global session and hides transport errors.
    scope = ' after:%s before:%s' % window if window else ' when:%dd' % days
    response = session.get('https://news.google.com/rss/search',
                           params={'q': query + scope, 'hl': 'ko', 'gl': 'KR', 'ceid': 'KR:ko'},
                           timeout=20)
    root = ET.fromstring(response.content)
    if root.tag != 'rss':
        raise ValueError('not an RSS response')
    return [{'rawtitle': clean(item.findtext('title')), 'glink': clean(item.findtext('link')),
             'pub': clean(item.findtext('pubDate')), 'media': clean(item.findtext('source')),
             'desc': clean(item.findtext('description'))}
            for item in root.iter('item') if '/articles/' in (item.findtext('link') or '')]


def naver_news(session, query, credentials, start=1):
    if not credentials_valid(credentials):
        return []
    response = session.get('https://openapi.naver.com/v1/search/news.json',
                           params={'query': query, 'display': 100, 'start': start, 'sort': 'date'},
                           headers={'X-Naver-Client-Id': credentials['id'],
                                    'X-Naver-Client-Secret': credentials['secret']}, timeout=20)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get('items'), list):
        raise ValueError('invalid news API response')
    return [{'title': clean(item.get('title')), 'desc': clean(item.get('description')),
             'url': item.get('originallink') or item.get('link'), 'pub': item.get('pubDate'), 'media': ''}
            for item in payload['items'] if isinstance(item, dict)]


def published(value):
    """Aware UTC datetime of an RFC-822 pubDate, or None when absent/invalid (never guessed)."""
    try:
        stamp = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if stamp is None:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(timezone.utc)


def limits(days, max_requests=None, max_candidates=None):
    """Raised default budgets apply only to an explicit backfill (days > 4)."""
    default_requests, default_candidates = BACKFILL_LIMITS if days > REGULAR_DAYS else REGULAR_LIMITS
    return (default_requests if max_requests is None else max_requests,
            default_candidates if max_candidates is None else max_candidates)


def strip_outlet(title, site):
    """Drop a trailing ' - 매체명' / ' | 매체명' left by a page <title>; keep the headline intact."""
    parts = re.split(r'\s+[-|–]\s+', title)
    if len(parts) > 1:
        tail = parts[-1].strip()
        if (site and squeeze(tail) in squeeze(site)) or (len(tail) <= 12 and not re.search(r'[…"“”?!]', tail)):
            head = ' - '.join(parts[:-1]).strip()
            if len(head) >= 8:
                return head
    return title


def image_name(url):
    return 'al_' + hashlib.md5(url_key(url).encode('utf-8')).hexdigest()[:10] + '.jpg'


def attach_image(session, row, image_url):
    """Download og:image into the board image folder; failures leave the row without a thumbnail."""
    row['img_checked'] = True
    if not image_url:
        return False
    os.makedirs(IMGDIR, exist_ok=True)
    name = image_name(row['url'])
    if dl_img(session, image_url, os.path.join(IMGDIR, name), row['url']):
        row['img'] = 'img/' + name
        return True
    return False


def cut_title(title):
    return len(re.sub(r'\[[^\]]*\]|≪[^≫]*≫|<[^>]*>', '', title or '').strip(' ,…·-')) < 12


def repair_titles(session, rows, limit):
    """Re-read headlines that were saved cut off (e.g. '[데일리팜]', '건보공단,')."""
    todo = [row for row in rows if row.get('url') and cut_title(row.get('title'))][:limit]

    def one(row):
        meta = fetch_meta(session, row['url'])
        if not meta:
            return False
        title = clean(best_title(meta.get('title'), meta.get('ptitle'), row.get('title')) or '')
        title = strip_outlet(title, meta.get('site') or '')
        if title and not cut_title(title) and title != row.get('title'):
            row['title'] = title
            row.setdefault('topic_evidence', []).append({'title': title, 'desc': clean(meta.get('desc'))})
            return True
        return False

    with ThreadPoolExecutor(PAGE_WORKERS) as pool:
        fixed = sum(pool.map(one, todo))
    return {'tried': len(todo), 'fixed': fixed}


def repair_images(session, rows, limit, pause=0.3):
    """Fill thumbnails for stored articles that never had one (each article is tried once)."""
    todo = [row for row in rows if not (row.get('img') or row.get('img_checked')) and row.get('url')][:limit]

    def one(row):
        meta = fetch_meta(session, row['url'])
        if not meta:
            return None  # page unreachable now: retry in a later run instead of giving up
        filled = attach_image(session, row, meta.get('img'))
        time.sleep(pause)
        return filled

    done = 0
    with ThreadPoolExecutor(PAGE_WORKERS) as pool:
        for index, filled in enumerate(pool.map(one, todo), 1):
            done += bool(filled)
            if index % 50 == 0:
                print('[allied 썸네일] 시도 %d/%d, 성공 %d' % (index, len(todo), done), flush=True)
    return {'tried': len(todo), 'filled': done}


def windows(now, days):
    """Week-sized [after, before) date windows covering the last `days` days."""
    end = (now + timedelta(days=1)).date()
    start = (now - timedelta(days=days)).date()
    result = []
    while end > start:
        begin = max(start, end - timedelta(days=WINDOW_DAYS))
        result.append((begin.isoformat(), end.isoformat()))
        end = begin
    return result


def article_evidence(row):
    evidence = {}
    for item in [row] + row.get('topic_evidence', []):
        title, desc = clean(item.get('title')), clean(item.get('desc'))
        if title:
            evidence[(title, desc)] = {'title': title, 'desc': desc}
    return list(evidence.values())


def article_topics(row):
    matched = {topic for item in article_evidence(row)
               for topic in classify(item['title'], item['desc'], row.get('url', ''))}
    return [topic for topic in TOPICS if topic in matched]


def merge_article(first, second):
    merged = dict(first)
    for key, value in second.items():
        if value not in (None, '', []):
            merged[key] = value
    merged['topics'] = [topic for topic in TOPICS if topic in first.get('topics', []) + second.get('topics', [])]
    aliases = list(dict.fromkeys(first.get('search_urls', []) + second.get('search_urls', [])))
    if aliases:
        merged['search_urls'] = aliases
    merged['topic_evidence'] = article_evidence({'topic_evidence': article_evidence(first) + article_evidence(second)})
    return merged


def collect(session, credentials=None, *, known=(), keywords=None, topic=None, max_requests=None,
            max_candidates=None, pages=2, report=None, days=REGULAR_DAYS, now=None):
    """days>4 is a bounded one-shot backfill; days=4 keeps the hourly request pattern."""
    if not 1 <= days <= MAX_DAYS:
        raise ValueError('invalid days')
    max_requests, max_candidates = limits(days, max_requests, max_candidates)
    if max_requests < 0 or max_candidates < 1 or not 1 <= pages <= 2:
        raise ValueError('invalid collection limits')
    backfill = days > REGULAR_DAYS
    now = datetime.now(timezone.utc) if now is None else now
    cutoff = now - timedelta(days=days)
    report = {} if report is None else report
    http = RequestBudget(session, max_requests, report)
    report.update(days=days, backfill=backfill, cutoff=cutoff.isoformat())
    report['sources']['naver'] = {'requests': 0, 'status': 'pending' if credentials_valid(credentials) else 'missing_credentials'}
    groups = [QUERIES[name] for name in ([topic] if topic else TOPICS)]
    queries = list(dict.fromkeys(keywords if keywords is not None else
                                (q for group in zip_longest(*groups) for q in group if q)))
    report.update(config_hash=CONFIG_HASH, planned_queries=len(queries), max_candidates=max_candidates, pages=pages)
    cache = {url_key(row['url']): dict(row) for row in known if row.get('url')}
    decode_cache = {url_key(alias): row['url'] for row in known for alias in row.get('search_urls', [])}
    attempted, candidates, result = set(), set(), {}
    candidate_records, meta_cache = {}, {}

    def search_title(row):
        title = row.get('title') or row.get('rawtitle') or ''
        suffix = ' - ' + row.get('media', '')
        return title[:-len(suffix)] if row.get('media') and title.endswith(suffix) else title

    def relevant(row):
        return bool(classify(search_title(row), row.get('desc'), row.get('url') or ''))

    def prefetch(rows):
        """Resolve Google links and article pages in parallel before the ordered ingest."""
        slots = max(0, max_candidates - len(candidates))
        chosen = [row for row in rows if relevant(row)][:slots]
        aliases = list(dict.fromkeys(row['glink'] for row in chosen if row.get('glink')
                                     and url_key(row['glink']) not in decode_cache))
        if aliases and 'google' not in http.blocked:
            google = http.for_source('google')
            with ThreadPoolExecutor(DECODE_WORKERS) as pool:
                for alias, url in zip(aliases, pool.map(lambda a: decode_gnews(google, a), aliases)):
                    decode_cache[url_key(alias)] = url
        urls = []
        for row in chosen:
            url = decode_cache.get(url_key(row['glink'])) if row.get('glink') else row.get('url')
            if url and url.startswith(('https://', 'http://')):
                key = url_key(url)
                if key not in cache and key not in attempted and key not in meta_cache:
                    urls.append(url)
        urls = list(dict.fromkeys(urls))
        if urls and 'metadata' not in http.blocked:
            pages = http.for_source('metadata')
            with ThreadPoolExecutor(PAGE_WORKERS) as pool:
                for url, meta in zip(urls, pool.map(lambda u: fetch_meta(pages, u), urls)):
                    meta_cache[url_key(url)] = meta or {}

    def ingest(row):
        alias = row.get('glink')
        raw_url = alias or row.get('url') or ''
        if not raw_url.startswith(('https://', 'http://')):
            return
        raw_key = url_key(raw_url)
        if not relevant(row):
            # Titles are classified before any page request: unrelated results cost nothing.
            candidate_records.setdefault(raw_key, {'title': clean(search_title(row)), 'desc': clean(row.get('desc')),
                                                   'url': raw_url, 'topics': [], 'status': 'rejected',
                                                   'reason': 'title_rules'})
            return
        if raw_key not in candidates:
            if len(candidates) >= max_candidates:
                report['stop_reason'] = 'candidate_budget'
                return
            candidates.add(raw_key)
        if alias:
            if raw_key not in decode_cache:
                http.source = 'google'
                decode_cache[raw_key] = (decode_gnews(http, alias)
                                         if http.count < max_requests and 'google' not in http.blocked else None)
            url = decode_cache[raw_key]
        else:
            url = raw_url
        title = row.get('title') or row.get('rawtitle') or ''
        suffix = ' - ' + row.get('media', '')
        if row.get('media') and title.endswith(suffix):
            title = title[:-len(suffix)]
        evidence = {'title': clean(title), 'desc': clean(row.get('desc')), 'url': url or raw_url}
        evidence['topics'] = classify(evidence['title'], evidence['desc'], evidence['url'])
        if not url or not url.startswith(('https://', 'http://')):
            candidate_records[raw_key] = {**evidence, 'status': 'candidate', 'reason': 'decode_unavailable'}
            return
        key = url_key(url)
        aliases = {'search_urls': [alias]} if alias else {}
        if key in cache:
            row_topics = evidence['topics']
            cached = merge_article(cache[key], {**aliases, 'topics': row_topics, 'topic_evidence': [evidence]})
            cache[key] = cached
            result[key] = cached
            return
        if key in attempted:
            if key in result:
                result[key] = merge_article(result[key], {**aliases, 'topics': evidence['topics'], 'topic_evidence': [evidence]})
            return
        attempted.add(key)
        http.source = 'metadata'
        if key in meta_cache:
            meta = meta_cache[key]
        else:
            meta = ((fetch_meta(http, url) or {})
                    if http.count < max_requests and 'metadata' not in http.blocked else {})
        meta_title = clean(meta.get('title') or meta.get('ptitle'))
        if not meta_title or any(marker.lower() in meta_title.lower() for marker in BAD_PAGE_TITLE):
            candidate_records[raw_key] = {**evidence, 'status': 'candidate', 'reason': 'metadata_unavailable'}
            return
        title = clean(best_title(meta.get('title'), meta.get('ptitle'), title) or meta_title)
        title = strip_outlet(title, meta.get('site') or row.get('media') or '')
        desc = clean(meta.get('desc') or row.get('desc'))
        topics = [name for name in TOPICS if name in classify(title, desc, url) + evidence['topics']]
        if not topics:
            candidate_records[raw_key] = {**evidence, 'status': 'rejected', 'reason': 'topic_rules'}
            return
        date, dt = parse_pub(row.get('pub'))
        result[key] = {'title': title, 'desc': desc, 'url': url, 'topics': topics,
                       'chip': resolve_chip(urlsplit(url).netloc, meta.get('site') or row.get('media'), desc, title),
                       'date': meta.get('date') or date or '', 'dt': meta.get('dt') or dt or '',
                       'img': '', 'img_meta': meta.get('img') or '', 'source': 'news-search', 'retrieval_status': 'retrieved',
                       'topic_evidence': article_evidence(evidence), **aliases}

    started = time.monotonic()
    for number, query in enumerate(queries, 1):
        print('[allied %d/%d] %s | 요청 %d/%d | 후보 %d/%d | 채택 %d | 경과 %d분' % (
            number, len(queries), query, http.count, max_requests, len(candidates), max_candidates,
            len(result), (time.monotonic() - started) // 60), flush=True)
        if http.count >= max_requests or len(candidates) >= max_candidates:
            report['stop_reason'] = 'request_budget' if http.count >= max_requests else 'candidate_budget'
            break
        if 'google' not in http.blocked:
            http.source = 'google'
            try:
                rows = []
                for window in (windows(now, days) if backfill else [None]):
                    rows.extend(gnews_rss(http, query, days, window))
                report['sources'].setdefault('google', {'requests': 0})['status'] = 'ok' if rows else 'empty'
                report['queries'].append({'source': 'google', 'query': query, 'status': 'ok' if rows else 'empty', 'count': len(rows)})
                prefetch(rows)
                for row in rows:
                    ingest(row)
                    if len(candidates) >= max_candidates:
                        break
            except (requests.RequestException, ValueError, ET.ParseError):
                state = report['sources'].setdefault('google', {'requests': 0})
                if state.get('status') not in ('rate_limited', 'unavailable'):
                    state['status'] = 'error'
                report['queries'].append({'source': 'google', 'query': query, 'status': state['status']})
        if credentials_valid(credentials) and 'naver' not in http.blocked:
            for page in range(BACKFILL_PAGES if backfill else pages):
                if http.count >= max_requests or len(candidates) >= max_candidates:
                    break
                http.source = 'naver'
                try:
                    rows = raw_rows = naver_news(http, query, credentials, start=1 + page * 100)
                    report['sources']['naver']['status'] = 'ok' if rows else 'empty'
                    report['queries'].append({'source': 'naver', 'query': query, 'page': page + 1,
                                              'status': 'ok' if rows else 'empty', 'count': len(rows)})
                except (requests.RequestException, ValueError, KeyError):
                    state = report['sources']['naver']
                    if state.get('status') not in ('rate_limited', 'unavailable'):
                        state['status'] = 'error'
                    report['queries'].append({'source': 'naver', 'query': query, 'page': page + 1, 'status': state['status']})
                    break
                overlap = bool(rows) and all(url_key(row.get('url') or '') in cache for row in rows)
                older = False
                if backfill:
                    stamps = [published(row.get('pub')) for row in rows]
                    older = any(stamp is not None and stamp < cutoff for stamp in stamps)
                    # Out-of-window items are dropped; undated items are kept (not guessed).
                    rows = [row for row, stamp in zip(rows, stamps) if stamp is None or stamp >= cutoff]
                prefetch(rows)
                for row in rows:
                    ingest(row)
                    if len(candidates) >= max_candidates:
                        break
                # Backfill ignores the all-seen overlap: older unseen pages may follow.
                if len(raw_rows) < 100 or older or (overlap and not backfill):
                    break
    report.update(candidate_count=len(candidates), accepted=len(result), candidates=list(candidate_records.values()),
                  workers={'decode': DECODE_WORKERS, 'pages': PAGE_WORKERS},
                  elapsed_seconds=round(time.monotonic() - started))
    if http.count >= max_requests:
        report['stop_reason'] = 'request_budget'
    if len(candidates) >= max_candidates:
        report['stop_reason'] = 'candidate_budget'
    return list(result.values())


def load_json(path, default):
    if not os.path.isfile(path):
        return default
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def save_json(path, value):
    with open(path + '.tmp', 'w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
    os.replace(path + '.tmp', path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', default=HERE)
    parser.add_argument('--keywords', nargs='+')
    parser.add_argument('--topic', choices=tuple(TOPICS))
    parser.add_argument('--max-requests', type=int)
    parser.add_argument('--max-candidates', type=int)
    parser.add_argument('--pages', type=int, choices=(1, 2), default=2)
    parser.add_argument('--days', type=int, default=REGULAR_DAYS,
                        help='search window in days (1..31); >4 is a bounded one-shot backfill')
    args = parser.parse_args(argv)
    if not 1 <= args.days <= MAX_DAYS:
        parser.error('--days must be between 1 and %d' % MAX_DAYS)
    args.max_requests, args.max_candidates = limits(args.days, args.max_requests, args.max_candidates)
    if args.max_requests < 0 or args.max_candidates < 1:
        parser.error('max-requests must be nonnegative; max-candidates must be positive')
    credentials = None
    if args.max_requests:
        credentials = {'id': os.environ.get('NAVER_ID'), 'secret': os.environ.get('NAVER_SECRET')}
        if not credentials_valid(credentials):
            try:
                credentials = load_json(os.path.join(HERE, 'naver_key.json'), None)
            except (OSError, ValueError):
                credentials = None
    os.makedirs(args.output_dir, exist_ok=True)
    merged = {}
    rejected_path = os.path.join(args.output_dir, 'allied_rejected.json')
    rejected = load_json(rejected_path, [])
    audit_keys = {json.dumps(row.get('article'), sort_keys=True, ensure_ascii=False) for row in rejected}
    for topic in TOPICS:
        for old in load_json(os.path.join(args.output_dir, topic + '.json'), []):
            topics = article_topics(old)
            if not topics or not old.get('url'):
                fingerprint = json.dumps(old, sort_keys=True, ensure_ascii=False)
                if fingerprint not in audit_keys:
                    rejected.append({'reason': 'local_topic_rules', 'article': old})
                    audit_keys.add(fingerprint)
                continue
            row = {**old, 'topics': topics}
            key = url_key(row['url'])
            merged[key] = merge_article(merged[key], row) if key in merged else row
    report = {'attempted_at': datetime.now(timezone.utc).isoformat()}
    with requests.Session() as session:
        session.headers.update(H)
        fresh = collect(session, credentials, known=list(merged.values()), keywords=args.keywords, topic=args.topic,
                        max_requests=args.max_requests, max_candidates=args.max_candidates, pages=args.pages,
                        report=report, days=args.days)
    with requests.Session() as images:
        images.headers.update(H)
        for row in fresh:
            if not row.get('img') and row.get('img_meta'):
                attach_image(images, row, row.get('img_meta'))
            row.pop('img_meta', None)
    for row in fresh:
        key = url_key(row['url'])
        merged[key] = merge_article(merged[key], row) if key in merged else row
    with requests.Session() as images:
        images.headers.update(H)
        rows = sorted(merged.values(), key=lambda row: row.get('dt') or '', reverse=True)
        report['titles'] = (repair_titles(images, rows, 400) if args.max_requests
                            else {'tried': 0, 'fixed': 0})
        report['images'] = (repair_images(images, rows, IMAGE_REPAIRS[args.days > REGULAR_DAYS])
                            if args.max_requests else {'tried': 0, 'filled': 0})
    for key, row in list(merged.items()):
        row['topics'] = article_topics(row)
        if not row['topics']:
            rejected.append({'reason': 'local_topic_rules', 'article': merged.pop(key)})
    # Save the complete rejected originals before replacing any published feed.
    if rejected:
        save_json(rejected_path, rejected)
    for topic in TOPICS:
        rows = sorted((row for row in merged.values() if topic in row['topics']),
                      key=lambda row: row.get('dt') or '', reverse=True)
        save_json(os.path.join(args.output_dir, topic + '.json'), rows)
        report[topic] = len(rows)
    report['rejected_archive'] = len(rejected)
    save_json(os.path.join(args.output_dir, 'allied_status.json'), report)
    print(json.dumps({key: report[key] for key in ('days', 'requests', 'stop_reason', 'psych', 'pharm', 'images', 'rejected_archive')},
                     ensure_ascii=False))
    return report


if __name__ == '__main__':
    main()

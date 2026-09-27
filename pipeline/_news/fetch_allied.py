# -*- coding: utf-8 -*-
"""심리상담·약사 정책 뉴스. 누적 보존, 한도 있는 Google RSS/네이버 공식 API 수집."""
import argparse
import html
import json
import os
import re
from datetime import datetime, timezone
from itertools import zip_longest
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree as ET

import requests
from buzz_config import CONFIG_HASH, SPECS
from fetch_press import BAD_PAGE_TITLE, H, decode_gnews, fetch_meta, parse_pub, resolve_chip

HERE = os.path.dirname(os.path.abspath(__file__))
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
BLOCK_HOSTS = ('blog.naver.com', 'cafe.naver.com', 'youtube.com', 'instagram.com')
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


def classify(title, description='', url=''):
    """Only article title/description; Korean words may take particles, not arbitrary prefixes."""
    text = clean(title) + ' ' + clean(description)
    compact = re.sub(r'\s+', '', text)
    host = (urlsplit(url).hostname or '').lower()
    if not clean(title) or any(host == h or host.endswith('.' + h) for h in BLOCK_HOSTS):
        return []
    if any(re.sub(r'\s+', '', w) in compact for w in PROMO) and not any(w in compact for w in DEBATE):
        return []
    if not any(w in compact for w in POLICY):
        return []
    topics = [topic for topic, patterns in TOPIC_PATTERNS.items() if any(p.search(text) for p in patterns)]
    if ('psych' not in topics and any(p.search(text) for p in GENERAL_JOBS)
            and any(p.search(text) for p in MENTAL_CONTEXT)):
        topics.insert(0, 'psych')
    if ('psych' not in topics and any(p.search(text) for p in ORGANIZATIONS)
            and any(word in compact for word in ORGANIZATION_POLICY)):
        topics.insert(0, 'psych')
    return topics


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
        report.update(requests=0, max_requests=maximum, sources={}, queries=[], candidates=[], stop_reason=None)

    def request(self, method, url, **kwargs):
        source = self.source
        status = self.report['sources'].setdefault(source, {'requests': 0, 'status': 'pending'})
        for _ in range(6):
            if self.count >= self.maximum or source in self.blocked:
                if self.count >= self.maximum:
                    self.report['stop_reason'] = 'request_budget'
                raise requests.RequestException('request budget or source backoff')
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

    def get(self, url, **kwargs):
        return self.request('get', url, **kwargs)

    def post(self, url, **kwargs):
        return self.request('post', url, **kwargs)


def gnews_rss(session, query):
    # fetch_press.gnews_rss uses a separate global session and hides transport errors.
    response = session.get('https://news.google.com/rss/search',
                           params={'q': query + ' when:4d', 'hl': 'ko', 'gl': 'KR', 'ceid': 'KR:ko'}, timeout=20)
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


def collect(session, credentials=None, *, known=(), keywords=None, topic=None, max_requests=160,
            max_candidates=400, pages=2, report=None):
    if max_requests < 0 or max_candidates < 1 or not 1 <= pages <= 2:
        raise ValueError('invalid collection limits')
    report = {} if report is None else report
    http = RequestBudget(session, max_requests, report)
    report['sources']['naver'] = {'requests': 0, 'status': 'pending' if credentials_valid(credentials) else 'missing_credentials'}
    groups = [QUERIES[name] for name in ([topic] if topic else TOPICS)]
    queries = list(dict.fromkeys(keywords if keywords is not None else
                                (q for group in zip_longest(*groups) for q in group if q)))
    report.update(config_hash=CONFIG_HASH, planned_queries=len(queries), max_candidates=max_candidates, pages=pages)
    cache = {url_key(row['url']): dict(row) for row in known if row.get('url')}
    decode_cache = {url_key(alias): row['url'] for row in known for alias in row.get('search_urls', [])}
    attempted, candidates, result = set(), set(), {}
    candidate_records = {}

    def ingest(row):
        alias = row.get('glink')
        raw_url = alias or row.get('url') or ''
        if not raw_url.startswith(('https://', 'http://')):
            return
        raw_key = url_key(raw_url)
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
        meta = ((fetch_meta(http, url) or {})
                if http.count < max_requests and 'metadata' not in http.blocked else {})
        meta_title = clean(meta.get('title') or meta.get('ptitle'))
        if not meta_title or any(marker.lower() in meta_title.lower() for marker in BAD_PAGE_TITLE):
            candidate_records[raw_key] = {**evidence, 'status': 'candidate', 'reason': 'metadata_unavailable'}
            return
        title = clean(meta.get('title') or meta.get('ptitle') or title)
        desc = clean(meta.get('desc') or row.get('desc'))
        topics = [name for name in TOPICS if name in classify(title, desc, url) + evidence['topics']]
        if not topics:
            candidate_records[raw_key] = {**evidence, 'status': 'rejected', 'reason': 'topic_rules'}
            return
        date, dt = parse_pub(row.get('pub'))
        result[key] = {'title': title, 'desc': desc, 'url': url, 'topics': topics,
                       'chip': resolve_chip(urlsplit(url).netloc, meta.get('site') or row.get('media'), desc, title),
                       'date': meta.get('date') or date or '', 'dt': meta.get('dt') or dt or '',
                       'img': '', 'source': 'news-search', 'retrieval_status': 'retrieved',
                       'topic_evidence': article_evidence(evidence), **aliases}

    for query in queries:
        if http.count >= max_requests or len(candidates) >= max_candidates:
            report['stop_reason'] = 'request_budget' if http.count >= max_requests else 'candidate_budget'
            break
        if 'google' not in http.blocked:
            http.source = 'google'
            try:
                rows = gnews_rss(http, query)
                report['sources'].setdefault('google', {'requests': 0})['status'] = 'ok' if rows else 'empty'
                report['queries'].append({'source': 'google', 'query': query, 'status': 'ok' if rows else 'empty', 'count': len(rows)})
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
            for page in range(pages):
                if http.count >= max_requests or len(candidates) >= max_candidates:
                    break
                http.source = 'naver'
                try:
                    rows = naver_news(http, query, credentials, start=1 + page * 100)
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
                for row in rows:
                    ingest(row)
                    if len(candidates) >= max_candidates:
                        break
                if len(rows) < 100 or overlap:
                    break
    report.update(candidate_count=len(candidates), accepted=len(result), candidates=list(candidate_records.values()))
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
    parser.add_argument('--max-requests', type=int, default=160)
    parser.add_argument('--max-candidates', type=int, default=400)
    parser.add_argument('--pages', type=int, choices=(1, 2), default=2)
    args = parser.parse_args(argv)
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
                        max_requests=args.max_requests, max_candidates=args.max_candidates, pages=args.pages, report=report)
    for row in fresh:
        key = url_key(row['url'])
        merged[key] = merge_article(merged[key], row) if key in merged else row
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
    print(json.dumps({key: report[key] for key in ('requests', 'stop_reason', 'psych', 'pharm', 'rejected_archive')},
                     ensure_ascii=False))
    return report


if __name__ == '__main__':
    main()

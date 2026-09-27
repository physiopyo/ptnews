# -*- coding: utf-8 -*-
"""Bounded, resumable Naver/Kakao samples, Datalab and Google News RSS.

Credentials and Kiwi are loaded inside execution, never at import. Canonical
provider totals are not an alias union. Storage has no age/count retention cut.
"""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import html
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from urllib.parse import urldefrag

import requests
import buzz_config as config
from buzz_history import BACKFILL, FIRST_SEEN, HistoryArchive, digest, kst_date, observed_at, summarize

ROOT = Path(__file__).resolve().parent
KST = timezone(timedelta(hours=9))
CHANNELS = {'blog': 'blog', 'news': 'news', 'cafe': 'cafearticle'}
MAX_BACKFILL_DAYS = 31
BACKFILL_BASIS = 'publication_date_backfill'
# Naver cafearticle has no publication date, so it is never backfilled (stays unknown).
BACKFILL_SOURCES = ('news', 'blog', 'daumcafe')
BACKFILL_PAGES = {'naver': 10, 'kakao': 10}  # naver start<=901 (+100); kakao page<=10 of size 50
BACKFILL_MAX_REQUESTS = {'naver': 2500, 'kakao': 1000}
STOP = set('''도수 치료 도수치료 관리 급여 관리급여 실손 보험 실손보험 체외 충격 충격파 체외충격파 물리 치료사 물리치료사 의료 병원 환자
경우 정도 사용 제품 가능 진행 시작 관련 내용 방법 정보 생각 이야기 이번 우리 가지 사람 자신 부분 문제 때문
다양 최근 다음 오늘 하나 모두 위해 통해 이상 이하 정말 제일 추천 후기 블로그 포스팅 사진 이용 확인 소개 운영
시간 오전 오후 요즘 경험 효과 진료 검사 상담 예약 위치 지역 방문 비용 가격 원장 선생 센터 의원 한의원
때문 이때 동안 이후 이전 현재 today 그것 무엇 어디 누구 정말 진짜 완전 그냥 약간 조금 거의 매우'''.split())


class CollectionError(Exception):
    """Only controlled codes leave the HTTP boundary; no response/auth text."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


class RequestBudget:
    def __init__(self, client, collection, limit, now):
        self.client, self.collection = client, collection
        self.limit, self.now, self.used = limit, now, 0
        self.stopped = set()

    @staticmethod
    def key(provider, kind):
        return f'{"rss" if provider == "google_news" else "mentions"}:{kind}:{provider}'

    def request(self, provider, method, url, **kwargs):
        key = self.key(provider, 'provider')
        state = self.collection.get(key, {})
        if provider in self.stopped or state.get('retry_after_at', 0) > self.now:
            raise CollectionError('provider_stopped')
        if self.used >= self.limit:
            raise CollectionError('request_budget_exhausted')
        self.used += 1
        stamp = observed_at(self.now)
        counters = self.collection.setdefault(self.key(provider, 'requests'), {})
        for zone in ('utc', 'kst'):
            day = stamp[zone][:10]
            daily = counters.setdefault(zone, {})
            daily[day] = daily.get(day, 0) + 1
        counters['total'] = counters.get('total', 0) + 1
        try:
            response = getattr(self.client, method)(url, **kwargs)
        except Exception:
            raise CollectionError('transport_error') from None
        if response.status_code == 429:
            retry = response.headers.get('Retry-After', '')
            retry_at = self.now + config.SIX_HOURS
            try:
                retry_at = self.now + max(0, int(retry))
            except (TypeError, ValueError):
                try:
                    retry_at = max(self.now, parsedate_to_datetime(retry).timestamp())
                except (TypeError, ValueError, OverflowError):
                    pass
            self.stopped.add(provider)
            self.collection[key] = {**state, 'status': 'rate_limited',
                                    'observed_at': stamp, 'retry_after_at': retry_at}
            raise CollectionError('http_429')
        if response.status_code != 200:
            raise CollectionError(f'http_{response.status_code}')
        if state.get('status') == 'rate_limited':
            self.collection[key] = {**state, 'status': 'ok'}
        return response


def response_json(response):
    try:
        value = response.json()
    except Exception:
        raise CollectionError('invalid_json') from None
    if not isinstance(value, dict):
        raise CollectionError('invalid_response')
    return value


def tag(value):
    if value is not None and not isinstance(value, str):
        raise CollectionError('invalid_search_document')
    return re.sub(r'<[^>]+>', '', html.unescape(value or '')).strip()


def terms_for(spec):
    return list(dict.fromkeys([spec['keyword'], *spec['terms']]))


def published_at(item, source):
    try:
        if source == 'blog':
            return datetime.strptime(item.get('postdate', ''), '%Y%m%d').date().isoformat()
        if source == 'news':
            return parsedate_to_datetime(item.get('pubDate', '')).isoformat()
        if source == 'daumcafe':
            return datetime.fromisoformat(item.get('datetime', '').replace('Z', '+00:00')).isoformat()
    except (AttributeError, TypeError, ValueError, OverflowError):
        pass
    return None


def search_sample(http, spec, source, headers):
    """First pages supply both totals/text; history reuses the same documents.

    All-seen URLs never terminate pagination: only provider end/short pages do.
    """
    provider = 'kakao' if source == 'daumcafe' else 'naver'
    size, pages = (50, 2) if provider == 'kakao' else (100, 1 if source == 'news' else 3)
    documents, totals, missing_urls = {}, {}, 0
    for term in terms_for(spec):
        for page in range(1, pages + 1):
            if provider == 'kakao':
                url = 'https://dapi.kakao.com/v2/search/cafe'
                params = {'query': term, 'size': size, 'page': page, 'sort': 'recency'}
            else:
                url = f'https://openapi.naver.com/v1/search/{CHANNELS[source]}.json'
                params = {'query': term, 'display': size, 'start': (page - 1) * size + 1, 'sort': 'date'}
            data = response_json(http.request(provider, 'get', url, params=params,
                                              headers=headers, timeout=15))
            if provider == 'kakao':
                items, meta = data.get('documents'), data.get('meta', {})
                total = meta.get('total_count') if isinstance(meta, dict) else None
            else:
                items, total = data.get('items'), data.get('total')
            if not isinstance(items, list) or type(total) is not int or total < 0:
                raise CollectionError('invalid_search_response')
            if page == 1:
                totals[term] = total
            for item in items:
                if not isinstance(item, dict):
                    raise CollectionError('invalid_search_document')
                raw_url = item.get('url' if provider == 'kakao' else 'link')
                if not isinstance(raw_url, str) or not raw_url:
                    missing_urls += 1
                    continue
                try:
                    url = urldefrag(raw_url)[0]
                except ValueError:
                    raise CollectionError('invalid_search_document') from None
                if url in documents:
                    continue
                text = tag(item.get('title', '')) + ' ' + tag(item.get('contents' if provider == 'kakao' else 'description', ''))
                documents[url] = {'url': url, 'provider': provider,
                                  'channel': 'cafe' if source == 'daumcafe' else source,
                                  'published_at': published_at(item, source), 'text': text,
                                  'content_hash': hashlib.sha256(text.encode('utf-8')).hexdigest()}
            if len(items) < size or (provider == 'kakao' and meta.get('is_end') is True):
                break
    return list(documents.values()), totals, missing_urls


class Analyzer:
    def __init__(self, kiwi, lexicon, specs):
        self.kiwi, self.lexicon, self.specs = kiwi, lexicon, specs
        self.fragments = None

    def analyze(self, documents):
        if not documents:
            return []
        if self.kiwi is None:
            from kiwipiepy import Kiwi
            self.kiwi = Kiwi()
        if self.fragments is None:
            self.fragments = {token.form for spec in self.specs for term in terms_for(spec)
                              for token in self.kiwi.tokenize(term)}
        result = []
        for document in documents:
            nouns, sentiment, tokens = Counter(), Counter(), Counter()
            for token in self.kiwi.tokenize(document['text']):
                tokens[(token.form, token.tag)] += 1
                noun = token.tag in ('NNG', 'NNP') and len(token.form) >= 2
                word = token.form if noun else token.form + '다' if token.tag in ('VA', 'VV') else None
                if not word or word in STOP or word in self.fragments:
                    continue
                if noun:
                    nouns[word] += 1
                if word in self.lexicon:
                    sentiment[word] += 1
            result.append({key: value for key, value in document.items() if key != 'text'} |
                          {'tokens': [{'form': form, 'tag': tag_, 'c': count}
                                      for (form, tag_), count in tokens.items()],
                           'related': dict(nouns), 'sentiment': {
                              word: {'c': count, 'p': self.lexicon[word]} for word, count in sentiment.items()}})
        return result


def set_status(collection, key, success, now, error=None, attempted=True):
    previous = collection.get(key, {})
    if not attempted:
        # A skipped request must not replace the last actual collection result.
        collection[key] = {**previous, 'last_deferred': {'at': now, 'reason': error}}
        if not previous:
            collection[key]['status'] = 'deferred'
    else:
        collection[key] = config.record(previous, success, error=error, now=now)
        if error == 'missing_credentials':
            collection[key]['status'] = 'missing'


def due(collection, key, interval, now, force):
    return force or config.due(collection.get(key, {}), interval, now=now)


def week_label(day):
    monday = day - timedelta(days=day.weekday())
    sunday = monday + timedelta(days=6)
    return monday.isoformat(), f'{monday.month}.{monday.day}~{sunday.month}.{sunday.day}'


def update_daily(source, keyword, documents, channel_history, daum_history, today):
    if source == 'daumcafe':
        # Legacy counts have no URL identities; do not add new samples to them.
        dates = Counter((doc.get('published_at') or today)[:10] for doc in documents)
        daily = daum_history.setdefault(keyword, {})
        dates.setdefault(today, 0)
        for date, count in dates.items():
            daily[date] = max(daily.get(date) or 0, count)
        return
    if source not in ('blog', 'cafe'):
        return
    state = channel_history.setdefault(keyword, {})
    seen_list = state.setdefault('sb' if source == 'blog' else 'sc', [])
    seen = set(seen_list)
    daily = state.setdefault('daily', {})
    daily.setdefault(today, {}).setdefault(source, 0)
    for document in documents:
        if document['url'] in seen:
            continue
        seen.add(document['url'])
        seen_list.append(document['url'])
        date = (document.get('published_at') or today)[:10] if source == 'blog' else today
        values = daily.setdefault(date, {})
        values[source] = (values.get(source) or 0) + 1
    state['basis'] = {'blog': 'published_date_when_known_else_first_seen', 'cafe': 'first_seen'}


def rss_count(http, spec, day):
    query = '(' + ' OR '.join('"' + term.replace('"', '') + '"' for term in terms_for(spec)) + ')'
    query += f' after:{day.isoformat()} before:{(day + timedelta(days=1)).isoformat()}'
    response = http.request('google_news', 'get', 'https://news.google.com/rss/search',
                            params={'q': query, 'hl': 'ko', 'gl': 'KR', 'ceid': 'KR:ko'},
                            headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
    try:
        root = ET.fromstring(response.content)
    except (ET.ParseError, TypeError):
        raise CollectionError('invalid_rss') from None
    if root.tag != 'rss' or root.find('channel') is None:
        raise CollectionError('invalid_rss')
    identities = set()
    for item in root.findall('./channel/item'):
        identity = item.findtext('link') or item.findtext('guid') or item.findtext('title')
        if not identity:
            raise CollectionError('invalid_rss_item')
        identities.add(identity)
    return len(identities)


def collect_rss(http, spec, history, archive, now, force):
    keyword, key = spec['keyword'], 'rss:' + spec['keyword']
    day = datetime.fromtimestamp(now, KST).date()
    prior = history.setdefault(keyword, {})
    missing = [day - timedelta(days=i) for i in range(2, 365)
               if prior.get((day - timedelta(days=i)).isoformat()) is None][:2]
    changed = False
    for status_key, interval, targets in (
            (key, config.SIX_HOURS, [day, day - timedelta(days=1)]),
            (key + ':backfill', config.DAY, missing)):
        if not targets or not due(http.collection, status_key, interval, now, force):
            continue
        before, error = http.used, None
        for target in targets:
            try:
                count = rss_count(http, spec, target)
            except CollectionError as exc:
                error = exc.code
                if error in ('http_429', 'provider_stopped', 'request_budget_exhausted'):
                    break
                continue
            prior[target.isoformat()] = count
            archive.snapshot('rss', keyword, 'google_news',
                             {'date': target.isoformat(), 'count': count, 'basis': 'rss_date_query'}, now)
            changed = True
        set_status(http.collection, status_key, error is None, now, error, attempted=http.used != before)
    return changed


def collect_datalab(http, specs, headers, naver, archive, now, force):
    day = datetime.fromtimestamp(now, KST).date()
    for group in config.batches(specs):
        group_id = digest([[s['keyword'], terms_for(s)] for s in group])[:16]
        key = 'datalab:' + group_id
        if not due(http.collection, key, config.DAY, now, force):
            continue
        if not headers:
            set_status(http.collection, key, False, now, 'missing_credentials')
            continue
        body = {'startDate': (day - timedelta(days=365)).isoformat(), 'endDate': day.isoformat(),
                'timeUnit': 'date', 'keywordGroups': [
                    {'groupName': spec['keyword'], 'keywords': terms_for(spec)} for spec in group]}
        before = http.used
        try:
            data = response_json(http.request('naver', 'post', 'https://openapi.naver.com/v1/datalab/search',
                                              headers={**headers, 'Content-Type': 'application/json'},
                                              json=body, timeout=20))
            results = data.get('results')
            if not isinstance(results, list):
                raise CollectionError('invalid_datalab_response')
            points = {}
            expected = {spec['keyword'] for spec in group}
            for item in results:
                if not isinstance(item, dict) or not isinstance(item.get('data'), list):
                    raise CollectionError('invalid_datalab_response')
                title = item.get('title')
                if not isinstance(title, str) or title not in expected or title in points:
                    raise CollectionError('invalid_datalab_response')
                values = {}
                for point in item['data']:
                    if not isinstance(point, dict):
                        raise CollectionError('invalid_datalab_point')
                    period, ratio = point.get('period'), point.get('ratio')
                    if (not isinstance(period, str) or type(ratio) not in (int, float)
                            or not math.isfinite(ratio) or not 0 <= ratio <= 100):
                        raise CollectionError('invalid_datalab_point')
                    try:
                        datetime.strptime(period, '%Y-%m-%d')
                    except ValueError:
                        raise CollectionError('invalid_datalab_point') from None
                    values[period] = round(ratio, 2)
                points[title] = values
            if any(spec['keyword'] not in points for spec in group):
                raise CollectionError('missing_datalab_group')
        except CollectionError as exc:
            set_status(http.collection, key, False, now, exc.code, attempted=http.used != before)
            continue
        previous = naver.setdefault('datalab', {'dates': [], 'series': {}})
        maps = {keyword: {date: value for date, value in zip(previous.get('dates', []), values)
                          if value is not None}
                for keyword, values in previous.get('series', {}).items()}
        for keyword, values in points.items():
            # A rolling request renormalizes every point. Do not splice its
            # ratios into a previous independently normalized request window.
            maps[keyword] = values
        dates = sorted({date for values in maps.values() for date in values})
        previous['dates'] = dates
        previous['series'] = {keyword: [values.get(date) for date in dates] for keyword, values in maps.items()}
        previous.setdefault('groups', {})[group_id] = {
            'keywords': [spec['keyword'] for spec in group], 'observed_at': observed_at(now),
            'normalization': 'within_request_group_and_date_range',
            'start_date': body['startDate'], 'end_date': body['endDate']}
        archive.snapshot('datalab', None, 'naver', {'group': group_id, 'request': body, 'points': points}, now)
        set_status(http.collection, key, True, now)


def backfill_search(http, spec, source, headers, cutoff, today):
    """Page sort=date/recency per alias until items predate cutoff, provider end or depth cap.

    Returns URL-deduplicated (across aliases) documents dated cutoff..yesterday (KST),
    plus the coverage floor: when any alias stopped before crossing the cutoff, dates
    older than its oldest retrieved date are unknown and that boundary date is partial.
    """
    provider = 'kakao' if source == 'daumcafe' else 'naver'
    size, pages = (50, BACKFILL_PAGES['kakao']) if provider == 'kakao' else (100, BACKFILL_PAGES['naver'])
    documents, floor, reason, undated, errors = {}, None, None, 0, []
    for term in terms_for(spec):
        oldest, state = None, 'search_depth'
        for page in range(1, pages + 1):
            if provider == 'kakao':
                url = 'https://dapi.kakao.com/v2/search/cafe'
                params = {'query': term, 'size': size, 'page': page, 'sort': 'recency'}
            else:
                url = f'https://openapi.naver.com/v1/search/{CHANNELS[source]}.json'
                params = {'query': term, 'display': size, 'start': (page - 1) * size + 1, 'sort': 'date'}
            try:
                data = response_json(http.request(provider, 'get', url, params=params,
                                                  headers=headers, timeout=15))
                items = data.get('documents' if provider == 'kakao' else 'items')
                meta = data.get('meta', {}) if provider == 'kakao' else {}
                if not isinstance(items, list) or not isinstance(meta, dict):
                    raise CollectionError('invalid_search_response')
                crossed = False
                for item in items:
                    if not isinstance(item, dict):
                        raise CollectionError('invalid_search_document')
                    date = kst_date(published_at(item, source))
                    if date is None:
                        undated += 1
                        continue
                    oldest = date if oldest is None else min(oldest, date)
                    if date < cutoff:
                        crossed = True
                        continue
                    raw_url = item.get('url' if provider == 'kakao' else 'link')
                    if date >= today or not isinstance(raw_url, str) or not raw_url:
                        continue
                    try:
                        link = urldefrag(raw_url)[0]
                    except ValueError:
                        raise CollectionError('invalid_search_document') from None
                    if link in documents:
                        continue
                    text = tag(item.get('title', '')) + ' ' + tag(
                        item.get('contents' if provider == 'kakao' else 'description', ''))
                    documents[link] = {'url': link, 'provider': provider,
                                       'channel': 'cafe' if source == 'daumcafe' else source,
                                       'published_at': published_at(item, source), 'text': text,
                                       'content_hash': hashlib.sha256(text.encode('utf-8')).hexdigest()}
            except CollectionError as exc:
                state = exc.code
                errors.append(exc.code)
                break
            if crossed:
                state = 'crossed_cutoff'
                break
            if len(items) < size or (provider == 'kakao' and meta.get('is_end') is True):
                state = 'provider_end'
                break
        if state not in ('crossed_cutoff', 'provider_end'):
            term_floor = oldest or today
            if floor is None or term_floor > floor:
                floor, reason = term_floor, state
    return documents, floor, reason, undated, errors


def run_backfill(clients, spec, headers, kakao_headers, histories, archive, analyzer, now, days):
    """One-shot publication-date backfill for one canonical keyword.

    Only (date, source) cells without an existing stored value are filled; nothing
    observed is overwritten. Documents join the permanent index with discovery
    'publication_date_backfill' so later regular runs do not count them as first seen.
    """
    keyword = spec['keyword']
    day = datetime.fromtimestamp(now, KST).date()
    today, stamp = day.isoformat(), observed_at(now)
    window = [(day - timedelta(days=offset)).isoformat() for offset in range(days, 0, -1)]
    channel = histories['channels'].setdefault(keyword, {})
    daily = channel.setdefault('daily', {})
    rss, daum = histories['news'].get(keyword, {}), histories['daum'].setdefault(keyword, {})
    report = {}
    for source in BACKFILL_SOURCES:
        key = f'backfill:{keyword}:{source}'
        provider = 'kakao' if source == 'daumcafe' else 'naver'
        http = clients[provider]
        source_headers = kakao_headers if source == 'daumcafe' else headers
        if source == 'daumcafe':
            needed = [date for date in window if daum.get(date) is None]
        elif source == 'news':
            needed = [date for date in window if rss.get(date) is None and daily.get(date, {}).get('news') is None]
        else:
            needed = [date for date in window if daily.get(date, {}).get('blog') is None]
        entry = {'days': days, 'attempted_at': now, 'basis': BACKFILL_BASIS, 'config_hash': config.CONFIG_HASH}
        if not source_headers:
            http.collection[key] = report[source] = {**entry, 'status': 'missing'}
            continue
        if not needed:
            # Word coverage still matters, but every count cell is already observed.
            http.collection[key] = report[source] = {**entry, 'status': 'already_observed', 'requests': 0}
            continue
        before = http.used
        documents, floor, reason, undated, errors = backfill_search(
            http, spec, source, source_headers, window[0], today)
        covered = [date for date in window if floor is None or date >= floor]
        if floor is not None and floor > window[-1]:
            covered = []
        in_range = [doc for doc in documents.values() if kst_date(doc['published_at']) in set(covered)]
        try:
            analyzed = analyzer.analyze(in_range)
        except Exception:
            errors.append('analysis_unavailable')
            covered, analyzed = [], []
        counts = Counter(kst_date(doc['published_at']) for doc in in_range)
        statuses, stored = {}, []
        previously = Counter(kst_date(doc['published_at']) for doc in analyzed
                             if archive.has(keyword, doc['url']))
        for date in covered:
            partial = floor is not None and date == floor
            info = {'count': counts.get(date, 0), 'status': 'partial' if partial else 'complete'}
            if partial:
                info['reason'] = reason
            if previously.get(date):
                info['previously_observed'] = previously[date]
            if date in needed:
                # Only unobserved cells are filled; existing observations always win.
                if source == 'daumcafe':
                    daum[date] = info['count']
                else:
                    daily.setdefault(date, {})[source] = info['count']
                meta = {'basis': BACKFILL_BASIS, 'status': info['status'], 'observed_at': stamp,
                        'provider': {'news': 'naver_news', 'blog': 'naver_blog', 'daumcafe': 'kakao_cafe'}[source]}
                if partial:
                    meta.update(reason=reason, reached=floor)
                channel.setdefault('backfill', {}).setdefault(date, {})[source] = meta
                stored.append(date)
            statuses[date] = info
        if analyzed:
            archive.observe(keyword, analyzed, now, discovery=BACKFILL)
        for date, info in statuses.items():
            archive.cover(keyword, date, 'cafe' if source == 'daumcafe' else source, now, basis=BACKFILL,
                          status=info['status'], previously_observed=info.get('previously_observed', 0))
            if source == 'blog':
                seen_list = channel.setdefault('sb', [])
                seen = set(seen_list)
                seen_list.extend(doc['url'] for doc in analyzed if doc['url'] not in seen)
        requests_used = http.used - before
        result = {**entry, 'status': ('error' if not covered and errors else
                                      'partial' if floor is not None else 'complete'),
                  'requests': requests_used, 'window': [window[0], window[-1]],
                  'covered_from': covered[0] if covered else None, 'reached': floor,
                  'reason': reason, 'errors': sorted(set(errors)), 'undated': undated,
                  'documents': len(in_range), 'stored_dates': len(stored)}
        if covered:
            archive.snapshot('mentions_backfill', keyword, source, {
                'channel': 'cafe' if source == 'daumcafe' else source, 'provider': provider,
                'basis': BACKFILL_BASIS, 'days': days, 'window': result['window'], 'reached': floor,
                'reason': reason, 'dates': statuses, 'stored_dates': stored}, now)
        http.collection[key] = report[source] = result
    return report


def add_known(values):
    return sum(values) if all(value is not None for value in values) else None


def channels_for(keyword, naver, channel_history, daum_history, news_history, today,
                 kakao_configured):
    rows = {row['date']: dict(row) for row in naver.get('channel_daily', {}).get(keyword, [])}
    channel = channel_history.get(keyword, {}).get('daily', {})
    backfill = channel_history.get(keyword, {}).get('backfill', {})
    daum, news = daum_history.get(keyword, {}), news_history.get(keyword, {})
    dates = set(rows) | set(channel) | set(daum) | set(news)
    dates.update((today - timedelta(days=i)).isoformat() for i in range(365))
    for date in dates:
        row = rows.setdefault(date, {'date': date})
        blog = channel.get(date, {}).get('blog')
        cafe_sources = {'naver': channel.get(date, {}).get('cafe'), 'kakao': daum.get(date)}
        cafe_observed = [source for source, value in cafe_sources.items() if value is not None]
        cafe_expected = ['naver']
        if kakao_configured or cafe_sources['kakao'] is not None:
            cafe_expected.append('kakao')
        cafe = sum(cafe_sources[source] for source in cafe_observed) if cafe_observed else None
        # Google RSS date counts win; Naver news backfill only fills dates RSS never observed.
        news_value = news.get(date)
        if news_value is None:
            news_value = channel.get(date, {}).get('news')
        used = {}
        for source, value in (('news', None if news.get(date) is not None else news_value),
                              ('blog', blog), ('daumcafe', cafe_sources['kakao'])):
            if value is not None and source in backfill.get(date, {}):
                used[source] = backfill[date][source]
        backfill_partial = any(meta.get('status') != 'complete' for meta in used.values())
        cafe_complete = (set(cafe_expected) <= set(cafe_observed)
                         and used.get('daumcafe', {}).get('status', 'complete') == 'complete')
        values = {'news': news_value, 'blog': blog, 'cafe': cafe}
        for name, value in values.items():
            if value is not None or name not in row:
                row[name] = value
        total = add_known([row.get(name) for name in ('news', 'blog', 'cafe')])
        if total is not None or 'total' not in row:
            row['total'] = total
        row['scope'] = {
            'cafe': {'expected': cafe_expected, 'observed': cafe_observed,
                     'components': cafe_sources,
                     'status': 'complete' if cafe_complete else 'partial' if cafe_observed else 'unknown'},
            'total': {'status': 'complete' if total is not None and cafe_complete and not backfill_partial else
                                'partial' if total is not None else 'unknown'},
        }
        if used:
            # Publication-date counts from a one-shot search backfill, not first-seen samples.
            row['scope']['backfill'] = used
    return [rows[date] for date in sorted(rows)]


SAMPLE_WORD_LIMIT = 200


def sample_summary(documents):
    """Capped word summary of one search sample (display of the latest sample only)."""
    summary = summarize(documents)
    return {'documents': summary['documents'], 'related': summary['related'][:SAMPLE_WORD_LIMIT],
            'sentiment': {channel: rows[:SAMPLE_WORD_LIMIT] for channel, rows in summary['sentiment'].items()}}


def refresh_words(naver, keyword):
    samples = {source: sample for source, sample in naver.get('samples', {}).get(keyword, {}).items()
               if isinstance(sample.get('summary'), dict)}
    coverage = {sample['channel'] for sample in samples.values()}
    related, sentiments, polarity = Counter(), {'blog': Counter(), 'cafe': Counter()}, {}
    documents = {'news': 0, 'blog': 0, 'cafe': 0}
    for sample in samples.values():
        summary, channel = sample['summary'], sample['channel']
        documents[channel] += summary['documents'].get(channel, 0)
        related.update({row['w']: row['c'] for row in summary['related']})
        if channel in sentiments:
            for row in summary['sentiment'].get(channel) or []:
                sentiments[channel][row['w']] += row['c']
                polarity[row['w']] = row['p']
    for channel in ('blog', 'news', 'cafe'):
        if channel not in coverage:
            documents[channel] = None
    rows = lambda counts, pol=None: [dict(row, **({'p': pol[row['w']]} if pol is not None else {}))
                                     for row in [{'w': w, 'c': c} for w, c in
                                                 sorted(counts.items(), key=lambda item: (-item[1], item[0]))]
                                     ][:SAMPLE_WORD_LIMIT]
    stored = naver.setdefault('related', {})
    if coverage == {'news', 'blog', 'cafe'} or stored.get(keyword) is None:
        stored[keyword] = rows(related)
    sentiment = naver.setdefault('sentiment', {}).setdefault(keyword, {})
    for channel in ('blog', 'cafe'):
        if channel in coverage:
            sentiment[channel] = rows(sentiments[channel], polarity)
    if {'blog', 'cafe'} <= coverage or (
            coverage.intersection({'blog', 'cafe'}) and sentiment.get('community') is None):
        sentiment['community'] = rows(sentiments['blog'] + sentiments['cafe'], polarity)
    for channel in ('community', 'blog', 'cafe'):
        sentiment.setdefault(channel, None)
    naver.setdefault('word_counts', {})[keyword] = {
        'documents': documents, 'coverage': sorted(coverage),
        'observed_at': {source: sample['observed_at'] for source, sample in samples.items()},
        'basis': 'latest_successful_deduplicated_sample'}


def run(output_dir, specs, credentials, client, now, kiwi=None, lexicon=None, max_requests=1000, force=False,
        backfill_days=0, backfill_max_requests=None):
    if max_requests < 0:
        raise ValueError('max_requests must be non-negative')
    if not 0 <= backfill_days <= MAX_BACKFILL_DAYS:
        raise ValueError('backfill_days must be 0..%d' % MAX_BACKFILL_DAYS)
    backfill_limits = {**BACKFILL_MAX_REQUESTS, **(backfill_max_requests or {})}
    if any(value < 0 for value in backfill_limits.values()):
        raise ValueError('backfill max requests must be non-negative')
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if max_requests == 0:
        return config.load(str(output_dir / 'buzz.json'), {}), 0
    archive = HistoryArchive(output_dir)
    archive.preserve_legacy()
    buzz = config.load(str(output_dir / 'buzz.json'), {})
    naver = buzz.setdefault('naver', {})
    collection = buzz.setdefault('collection', {})
    histories = {name: config.load(str(output_dir / filename), default) for name, filename, default in (
        ('totals', 'buzz_naver_history.json', []), ('weeks', 'buzz_related_weeks.json', {}),
        ('news', 'buzz_news_daily.json', {}), ('channels', 'buzz_channel_daily.json', {}),
        ('daum', 'buzz_daum_daily.json', {}), ('hourly', 'buzz_hourly.json', {}))}
    http = RequestBudget(client, collection, max_requests, now)
    analyzer = Analyzer(kiwi, lexicon or {}, specs)
    day = datetime.fromtimestamp(now, KST).date()
    today, stamp = day.isoformat(), observed_at(now)
    naver_key, kakao_key = credentials.get('naver') or {}, credentials.get('kakao') or {}
    headers = ({'X-Naver-Client-Id': naver_key['id'], 'X-Naver-Client-Secret': naver_key['secret'],
                'User-Agent': 'Mozilla/5.0'} if naver_key.get('id') and naver_key.get('secret') else None)
    kakao_headers = ({'Authorization': 'KakaoAK ' + kakao_key['rest_api_key']}
                     if kakao_key.get('rest_api_key') else None)
    if backfill_days:
        # Runs before regular sampling so regular first-seen counts cannot pre-empt
        # publication-date cells; separate bounded budgets per provider.
        clients = {provider: RequestBudget(client, collection, backfill_limits[provider], now)
                   for provider in ('naver', 'kakao')}
        details = {}
        for number, spec in enumerate(specs, 1):
            print('[여론 소급 %d/%d] %s | 네이버 요청 %d/%d | 카카오 요청 %d/%d' % (
                number, len(specs), spec['keyword'], clients['naver'].used, backfill_limits['naver'],
                clients['kakao'].used, backfill_limits['kakao']), flush=True)
            details[spec['keyword']] = run_backfill(clients, spec, headers, kakao_headers, histories,
                                                    archive, analyzer, now, backfill_days)
        buzz['backfill'] = {
            'days': backfill_days, 'basis': BACKFILL_BASIS, 'observed_at': stamp,
            'sources': list(BACKFILL_SOURCES), 'not_backfilled': {'cafearticle': 'no_publication_date'},
            'requests': {provider: http_.used for provider, http_ in clients.items()},
            'max_requests': backfill_limits,
            'status': {status: sum(1 for report in details.values() for item in report.values()
                                   if item['status'] == status)
                       for status in ('complete', 'partial', 'error', 'missing', 'already_observed')}}
        print('Backfill %d days; requests naver %d/%d, kakao %d/%d; %s' % (
            backfill_days, clients['naver'].used, backfill_limits['naver'], clients['kakao'].used,
            backfill_limits['kakao'], json.dumps(buzz['backfill']['status'])))
    successes = set()
    for number, spec in enumerate(specs, 1):
        keyword = spec['keyword']
        print('[여론 %d/%d] %s | 요청 %d/%d' % (number, len(specs), keyword, http.used, max_requests), flush=True)
        for source in ('blog', 'news', 'cafe', 'daumcafe'):
            key = f'mentions:{keyword}:{source}'
            if not due(collection, key, config.SIX_HOURS, now, force):
                continue
            source_headers = kakao_headers if source == 'daumcafe' else headers
            if not source_headers:
                set_status(collection, key, False, now, 'missing_credentials')
                continue
            before = http.used
            try:
                documents, totals, missing_urls = search_sample(http, spec, source, source_headers)
                try:
                    documents = analyzer.analyze(documents)
                except Exception:
                    raise CollectionError('analysis_unavailable') from None
            except CollectionError as exc:
                set_status(collection, key, False, now, exc.code, attempted=http.used != before)
                continue
            identifiers, _fresh = archive.observe(keyword, documents, now)
            archive.cover(keyword, today, 'cafe' if source == 'daumcafe' else source, now)
            sample = {'channel': 'cafe' if source == 'daumcafe' else source,
                      'documents': len(identifiers),
                      'observed_at': stamp, 'canonical_query': keyword,
                      'canonical_total': totals[keyword],
                      'alias_totals': {term: value for term, value in totals.items() if term != keyword},
                      'basis': 'url_deduplicated_search_sample', 'skipped_missing_url': missing_urls}
            archive.snapshot('mentions', keyword, source, sample, now)
            naver.setdefault('samples', {}).setdefault(keyword, {})[source] = {
                **sample, 'summary': sample_summary(documents)}
            naver.setdefault('totals', {}).setdefault(keyword, {})[source] = totals[keyword]
            naver.setdefault('totals_metadata', {}).setdefault(keyword, {})[source] = {
                'query': keyword, 'aliases': sample['alias_totals'], 'observed_at': stamp,
                'basis': 'canonical_provider_total_not_unique_alias_union'}
            update_daily(source, keyword, documents, histories['channels'], histories['daum'], today)
            set_status(collection, key, True, now)
            successes.add(keyword)
        if keyword in successes:
            refresh_words(naver, keyword)
        collect_rss(http, spec, histories['news'], archive, now, force)
    collect_datalab(http, specs, headers, naver, archive, now, force)
    for spec in specs:
        keyword = spec['keyword']
        totals = naver.setdefault('totals', {}).setdefault(keyword, {})
        for source in ('blog', 'news', 'cafe', 'daumcafe'):
            totals.setdefault(source, None)
        naver.setdefault('related', {}).setdefault(keyword, None)
        naver.setdefault('sentiment', {}).setdefault(keyword, {'community': None, 'blog': None, 'cafe': None})
        channel_rows = channels_for(keyword, naver, histories['channels'], histories['daum'],
                                    histories['news'], day, kakao_configured=bool(kakao_headers))
        naver.setdefault('channel_daily', {})[keyword] = channel_rows
        old_news = {row['date']: row for row in naver.get('news_daily', {}).get(keyword, [])}
        for row in channel_rows:
            date = row['date']
            if histories['news'].get(keyword, {}).get(date) is not None:
                old_news[date] = {'date': date, 'c': histories['news'][keyword][date]}
            else:
                old_news.setdefault(date, {'date': date, 'c': None})
        naver.setdefault('news_daily', {})[keyword] = [old_news[date] for date in sorted(old_news)]
        # Word rows live in buzz_archive/words (read by the board builder); buzz.json keeps
        # only pre-existing rows the archive cannot reproduce (never timestamp-invented).
        legacy_rows = [row for row in naver.get('word_daily', {}).get(keyword, [])
                       if row.get('basis') not in (FIRST_SEEN, BACKFILL)]
        if legacy_rows:
            naver.setdefault('word_daily', {})[keyword] = legacy_rows
        else:
            naver.get('word_daily', {}).pop(keyword, None)
        naver.get('word_daily_backfill', {}).pop(keyword, None)
        if keyword not in successes:
            continue
        wkey, label = week_label(day)
        if isinstance(naver['related'][keyword], list):
            histories['weeks'].setdefault(keyword, []).append({
                'key': wkey, 'label': label, 'items': naver['related'][keyword], 'observed_at': stamp})
        latest = next(row for row in channel_rows if row['date'] == today)
        histories['hourly'].setdefault(keyword, []).append({
            't': datetime.fromtimestamp(now, KST).strftime('%Y-%m-%d %H:%M'),
            **{name: latest.get(name) for name in ('news', 'blog', 'cafe')},
            'interval_hours': 6, 'observed_at': stamp,
            'state': {source: collection.get(f'mentions:{keyword}:{source}', {}).get('status', 'missing')
                      for source in ('blog', 'news', 'cafe', 'daumcafe')}})
    if successes:
        histories['totals'].append({'date': today, 'observed_at': stamp,
                                    'totals': {keyword: dict(naver['totals'][keyword]) for keyword in successes}})
    # Existing independently stored histories are retained in full; no slicing.
    for section, name in (('history', 'totals'), ('related_weeks', 'weeks'), ('hourly', 'hourly')):
        old = naver.get(section)
        current = histories[name]
        if isinstance(current, list):
            for value in old or []:
                if value not in current:
                    current.append(value)
        elif isinstance(old, dict):
            for keyword, values in old.items():
                target = current.setdefault(keyword, [])
                for value in values:
                    if value not in target:
                        target.append(value)
        naver[section] = current
    naver['hourly_interval_hours'] = 6
    naver.setdefault('datalab', {'dates': [], 'series': {}})
    naver['word_history_metadata'] = {
        'basis': 'unique_url_first_seen_kst', 'retention': 'permanent',
        'legacy_word_timestamps': 'unknown; preserved byte-for-byte, not assigned to periods',
        'related_channels': ['news', 'blog', 'cafe'], 'sentiment_channels': ['blog', 'cafe']}
    buzz['keywords'], buzz['subjects'], buzz['config'] = config.KEYWORDS, config.SUBJECTS, config.metadata()
    buzz['updated'] = datetime.fromtimestamp(now, KST).strftime('%Y-%m-%d %H:%M')
    archive.save()
    for name, filename in (('totals', 'buzz_naver_history.json'), ('weeks', 'buzz_related_weeks.json'),
                           ('news', 'buzz_news_daily.json'), ('channels', 'buzz_channel_daily.json'),
                           ('daum', 'buzz_daum_daily.json'), ('hourly', 'buzz_hourly.json')):
        config.save(str(output_dir / filename), histories[name])
    config.save(str(output_dir / 'buzz.json'), buzz)
    return buzz, http.used


def main(argv=None, *, client=None, clock=None, kiwi=None, credentials=None, lexicon=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT)
    parser.add_argument('--keywords', nargs='+', help='Canonical keywords; spaces are quoted, commas also accepted')
    parser.add_argument('--max-requests', type=int, default=1000)
    parser.add_argument('--backfill-days', type=int, default=0,
                        help='one-shot publication-date backfill window (0=off, max 31)')
    parser.add_argument('--backfill-max-requests', type=int, default=BACKFILL_MAX_REQUESTS['naver'],
                        help='Naver request cap for the backfill (separate from --max-requests)')
    parser.add_argument('--backfill-kakao-max-requests', type=int, default=BACKFILL_MAX_REQUESTS['kakao'])
    args = parser.parse_args(argv)
    if args.max_requests < 0:
        parser.error('--max-requests must be non-negative')
    if not 0 <= args.backfill_days <= MAX_BACKFILL_DAYS:
        parser.error('--backfill-days must be between 0 and %d' % MAX_BACKFILL_DAYS)
    if args.backfill_max_requests < 0 or args.backfill_kakao_max_requests < 0:
        parser.error('backfill request caps must be non-negative')
    selected = {term for value in args.keywords or [] for term in value.split(',')}
    if selected - set(config.KEYWORDS):
        parser.error('Unknown canonical keyword')
    specs = [spec for spec in config.SPECS if not selected or spec['keyword'] in selected]
    if credentials is None:
        credentials = {}
        for provider, filename in (('naver', 'naver_key.json'), ('kakao', 'kakao_key.json')):
            try:
                value = config.load(str(ROOT / filename), {})
                credentials[provider] = value if isinstance(value, dict) else {}
            except (OSError, ValueError):
                credentials[provider] = {}
    if lexicon is None:
        lexicon = config.load(str(ROOT / 'knu_senti.json'), {})
    now = clock() if clock else datetime.now(timezone.utc).timestamp()
    result, used = run(args.output_dir, specs, credentials, client if client is not None else requests,
                       now, kiwi=kiwi, lexicon=lexicon, max_requests=args.max_requests,
                       backfill_days=args.backfill_days,
                       backfill_max_requests={'naver': args.backfill_max_requests,
                                              'kakao': args.backfill_kakao_max_requests})
    print(f'Collection complete; HTTP requests: {used}/{args.max_requests}')
    return result


if __name__ == '__main__':
    main()

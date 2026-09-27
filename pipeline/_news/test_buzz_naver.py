"""Offline executable contracts. Fake HTTP/Kiwi only; never live collectors."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import buzz_config as config
from buzz_history import HistoryArchive, digest, observed_at
import fetch_buzz_naver as collector

STAGE = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 1, 31, 15, 0, tzinfo=timezone.utc).timestamp()
SPEC = {'keyword': '검색어', 'terms': ['검색어', '검색 어'], 'category': '검증', 'search_query': '검색어'}
CREDS = {'naver': {'id': 'fake-id', 'secret': 'fake-secret'}, 'kakao': {'rest_api_key': 'fake-kakao'}}
LEXICON = {'기쁨': 2, '불안': -2, '좋다': 1}


class FakeKiwi:
    def tokenize(self, text):
        return [SimpleNamespace(form=word[:-1] if word == '좋다' else word,
                                tag='VA' if word == '좋다' else 'NNG') for word in text.split()]


class Response:
    def __init__(self, data=None, status=200, content=b'', headers=None):
        self.data, self.status_code, self.content = data, status, content
        self.headers = headers or {}

    def json(self):
        if isinstance(self.data, Exception):
            raise self.data
        return deepcopy(self.data)


class FakeClient:
    def __init__(self, handler=None, empty=False):
        self.calls, self.handler, self.empty = [], handler, empty

    def get(self, url, **kwargs):
        return self.request('get', url, kwargs)

    def post(self, url, **kwargs):
        return self.request('post', url, kwargs)

    def request(self, method, url, kwargs):
        self.calls.append((method, url, deepcopy(kwargs)))
        if self.handler:
            result = self.handler(method, url, kwargs)
            if result is not None:
                return result
        if method == 'post':
            return Response({'results': [
                {'title': group['groupName'], 'data': [] if self.empty else [
                    {'period': '2026-01-31', 'ratio': 0}, {'period': '2026-02-01', 'ratio': 75}]}
                for group in kwargs['json']['keywordGroups']]})
        if 'news.google.com' in url:
            return Response(content=(b'<rss><channel></channel></rss>' if self.empty else
                b'<rss><channel><item><link>https://rss/one</link></item>'
                b'<item><link>https://rss/one</link></item>'
                b'<item><link>https://rss/two</link></item></channel></rss>'))
        term = kwargs['params']['query']
        alias = ' ' in term
        total = 0 if self.empty else 12 if alias else 7
        if 'dapi.kakao.com' in url:
            docs = [] if self.empty else [{'url': 'https://sample/daum', 'title': '기쁨 협력',
                                          'contents': '', 'datetime': '2026-01-20T10:00:00+09:00'}]
            return Response({'documents': docs, 'meta': {'total_count': total, 'is_end': True}})
        source = url.rsplit('/', 1)[-1].split('.')[0]
        text = {'blog': '기쁨 공통 좋다', 'news': '불안 보도', 'cafearticle': '불안 모임'}[source]
        common = {'link': f'https://sample/{source}', 'title': text, 'description': '',
                  'postdate': '20260120', 'pubDate': 'Tue, 20 Jan 2026 10:00:00 +0900'}
        docs = [] if self.empty else [common, deepcopy(common)]
        if not self.empty and alias and source == 'blog':
            docs.append({**common, 'link': 'https://sample/blog-alias', 'title': '기쁨 별칭'})
        return Response({'items': docs, 'total': total})


class OfflineCase(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='naver-offline-', dir=STAGE)
        self.root = Path(self.directory.name)
        self.no_network = patch('requests.sessions.Session.request', side_effect=AssertionError('Network forbidden in offline tests'))
        self.no_network.start()

    def tearDown(self):
        self.no_network.stop()
        self.directory.cleanup()

    def execute(self, client=None, now=NOW, specs=None, credentials=None, **kwargs):
        return collector.run(self.root, specs or [SPEC], CREDS if credentials is None else credentials,
                             client or FakeClient(), now, kiwi=FakeKiwi(), lexicon=LEXICON, **kwargs)

    def read(self, filename):
        return config.load(str(self.root / filename), {})

    def write(self, filename, value):
        config.save(str(self.root / filename), value)

    def word_daily(self, keyword='검색어'):
        return HistoryArchive(self.root).word_daily(keyword)

    def word_daily_backfill(self, keyword='검색어'):
        return HistoryArchive(self.root).word_daily_backfill(keyword)

    def assert_compact_archive(self, *texts):
        archive = self.root / 'buzz_archive'
        for path in archive.rglob('*.json'):
            if 'legacy' in path.relative_to(archive).parts:
                continue
            raw = path.read_text(encoding='utf-8')
            self.assertNotIn('"tokens"', raw, path)
            self.assertNotIn('\n ', raw, path)  # compact, not indented
            for text in texts:
                self.assertNotIn(text, raw, path)
        for path in (archive / 'index').glob('*.json'):
            for ids in json.loads(path.read_text(encoding='utf-8')).values():
                self.assertTrue(all(re.fullmatch('[0-9a-f]{16}', value) for value in ids), path)


class CollectorTests(OfflineCase):
    def test_actual_alias_payload_dedup_totals_words_and_reload_cadence(self):
        client = FakeClient()
        first, used = self.execute(client)
        self.assertEqual(used, 13)
        for source in ('blog', 'news', 'cafearticle'):
            calls = [call for call in client.calls if f'/{source}.json' in call[1]]
            self.assertEqual([call[2]['params']['query'] for call in calls], SPEC['terms'])
            self.assertTrue(all(call[2]['params']['display'] == 100 for call in calls))
        daum = [call for call in client.calls if 'dapi.kakao.com' in call[1]]
        self.assertEqual([call[2]['params']['query'] for call in daum], SPEC['terms'])
        naver = first['naver']
        self.assertEqual(naver['totals']['검색어']['blog'], 7)
        self.assertEqual(naver['totals_metadata']['검색어']['blog']['aliases'], {'검색 어': 12})
        self.assertEqual(naver['word_counts']['검색어']['documents'], {'news': 1, 'blog': 2, 'cafe': 2})
        related = {row['w']: row['c'] for row in naver['related']['검색어']}
        self.assertEqual(related['기쁨'], 3)
        senti = {row['w']: row['c'] for row in naver['sentiment']['검색어']['community']}
        self.assertEqual(senti['불안'], 1)  # news is not community sentiment
        self.assertNotIn('word_daily', naver)
        first_rows = self.word_daily()
        word_day = first_rows[0]
        self.assertEqual(word_day['date'], '2026-02-01')
        self.assertEqual(word_day['basis'], 'first_seen')
        self.assertEqual(word_day['observed_at']['utc'], '2026-01-31T15:00:00+00:00')
        self.assertEqual(word_day['observed_at']['kst'], '2026-02-01T00:00:00+09:00')
        counters = first['collection']['mentions:requests:naver']
        self.assertEqual(counters['utc'], {'2026-01-31': 7})
        self.assertEqual(counters['kst'], {'2026-02-01': 7})
        client2 = FakeClient()
        second, count = self.execute(client2, now=NOW + config.SIX_HOURS - 1)
        self.assertEqual(count, 0)
        self.assertEqual(client2.calls, [])
        self.assertEqual(second['naver']['totals'], first['naver']['totals'])
        self.assertEqual(self.word_daily(), first_rows)
        third, count = self.execute(now=NOW + config.SIX_HOURS)
        self.assertEqual(count, 10)
        self.assertEqual(self.word_daily()[0]['documents'], word_day['documents'])
        self.assertEqual(self.word_daily()[0]['related'], word_day['related'])
        self.assertEqual(len(third['naver']['hourly']['검색어']), 2)
        self.assertEqual(third['naver']['hourly']['검색어'][-1]['interval_hours'], 6)
        self.assertEqual(len(third['naver']['history']), 2)

    def test_daily_boundary_rss_or_queries_and_only_two_history_backfills(self):
        first_client = FakeClient()
        first, _ = self.execute(first_client)
        queries = [call[2]['params']['q'] for call in first_client.calls if 'news.google.com' in call[1]]
        self.assertEqual(len(queries), 4)
        self.assertTrue(all('("검색어" OR "검색 어")' in query for query in queries))
        dates = self.read('buzz_news_daily.json')['검색어']
        self.assertEqual(set(dates), {'2026-02-01', '2026-01-31', '2026-01-30', '2026-01-29'})
        self.assertTrue(all(value == 2 for value in dates.values()))
        rows = {row['date']: row for row in first['naver']['news_daily']['검색어']}
        self.assertIsNone(rows['2026-01-28']['c'])
        client = FakeClient()
        self.execute(client, now=NOW + config.DAY - 1)
        queries = [call[2]['params']['q'] for call in client.calls if 'news.google.com' in call[1]]
        self.assertEqual(len(queries), 2)
        self.assertTrue(all('after:2026-02-01' in query or 'after:2026-01-31' in query for query in queries))
        self.assertFalse(any(call[0] == 'post' for call in client.calls))
        client = FakeClient()
        result, _ = self.execute(client, now=NOW + config.DAY)
        queries = [call[2]['params']['q'] for call in client.calls if 'news.google.com' in call[1]]
        self.assertEqual(len(queries), 2)
        self.assertTrue(any('after:2026-01-28' in query for query in queries))
        self.assertTrue(any('after:2026-01-27' in query for query in queries))
        # The 23:59:59 mention observation is still fresh at midnight. RSS-only
        # work must not fabricate next-day word coverage or a false zero bucket.
        self.assertEqual([row['date'] for row in self.word_daily()], ['2026-02-01'])
        result, _ = self.execute(now=NOW + config.DAY + config.SIX_HOURS - 1)
        self.assertEqual(len(self.word_daily()), 2)
        self.assertEqual(self.word_daily()[1]['date'], '2026-02-02')
        self.assertEqual(self.word_daily()[1]['documents'], {'news': 0, 'blog': 0, 'cafe': 0})
        self.assertEqual(self.word_daily()[1]['coverage'], ['blog', 'cafe', 'news'])

    def test_rss_six_hour_refresh_and_daily_backfill_persist_across_processes(self):
        first, used = self.execute(credentials={})
        self.assertEqual(used, 4)
        self.assertEqual(first['collection']['rss:검색어:backfill']['attempted_at'], NOW)
        script = '''
import json
import sys
from unittest.mock import patch
from test_buzz_naver import collector, FakeClient, FakeKiwi, Response, SPEC, LEXICON
def updated(method, url, kwargs):
    return Response(content=b'<rss><channel><item><link>one</link></item></channel></rss>')
client = FakeClient(updated)
with patch('requests.sessions.Session.request', side_effect=AssertionError('Network forbidden')):
    result, used = collector.run(sys.argv[1], [SPEC], {}, client, float(sys.argv[2]),
                                 kiwi=FakeKiwi(), lexicon=LEXICON)
print(json.dumps({'used': used, 'queries': [call[2]['params']['q'] for call in client.calls]}))
'''
        for elapsed, expected_calls in ((config.SIX_HOURS - 1, 0), (config.SIX_HOURS, 2),
                                        (config.SIX_HOURS + 1, 0), (config.DAY, 4)):
            with self.subTest(elapsed=elapsed):
                process = subprocess.run([sys.executable, '-B', '-c', script, str(self.root), str(NOW + elapsed)],
                                         cwd=Path(__file__).resolve().parent, check=True,
                                         capture_output=True, text=True)
                receipt = json.loads(process.stdout)
                self.assertEqual(receipt['used'], expected_calls)
                self.assertEqual(len(receipt['queries']), expected_calls)
                saved = self.read('buzz.json')
                dates = self.read('buzz_news_daily.json')['검색어']
                if elapsed == config.SIX_HOURS:
                    self.assertEqual(set(dates), {'2026-02-01', '2026-01-31', '2026-01-30', '2026-01-29'})
                    self.assertEqual(dates['2026-02-01'], 1)
                    self.assertEqual(dates['2026-01-31'], 1)
                    self.assertEqual(dates['2026-01-30'], 2)
                    self.assertEqual(dates['2026-01-29'], 2)
                    rows = {row['date']: row for row in saved['naver']['channel_daily']['검색어']}
                    self.assertEqual(rows['2026-02-01']['news'], 1)
                    news = {row['date']: row['c'] for row in saved['naver']['news_daily']['검색어']}
                    self.assertEqual(news['2026-02-01'], 1)
                    self.assertEqual(saved['collection']['rss:검색어']['attempted_at'], NOW + elapsed)
                    self.assertEqual(saved['collection']['rss:검색어:backfill']['attempted_at'], NOW)
                elif elapsed == config.DAY:
                    self.assertEqual(set(dates) - {'2026-02-01', '2026-01-31', '2026-01-30', '2026-01-29'},
                                     {'2026-02-02', '2026-01-28', '2026-01-27'})
                    self.assertEqual(saved['collection']['rss:검색어:backfill']['attempted_at'], NOW + elapsed)

    def test_rss_refresh_failure_and_budget_preserve_values_and_backfill_status(self):
        first, _ = self.execute(credentials={})
        history = self.read('buzz_news_daily.json')
        failed = FakeClient(lambda method, url, kwargs: Response(content=b'<html>failure</html>'))
        result, used = self.execute(failed, credentials={}, now=NOW + config.SIX_HOURS)
        self.assertEqual(used, 2)
        self.assertEqual(self.read('buzz_news_daily.json'), history)
        self.assertEqual(result['collection']['rss:검색어']['success_at'], NOW)
        self.assertEqual(result['collection']['rss:검색어']['error'], 'invalid_rss')
        self.assertEqual(result['collection']['rss:검색어:backfill'], first['collection']['rss:검색어:backfill'])
        retry = FakeClient()
        self.execute(retry, credentials={}, now=NOW + config.SIX_HOURS + 1)
        self.assertEqual(retry.calls, [])
        client = FakeClient()
        result, used = self.execute(client, credentials={}, now=NOW + config.DAY, max_requests=2)
        self.assertEqual(used, len(client.calls))
        self.assertEqual(used, 2)
        self.assertEqual(result['collection']['rss:검색어']['success_at'], NOW + config.DAY)
        backfill = result['collection']['rss:검색어:backfill']
        self.assertEqual(backfill['attempted_at'], NOW)
        self.assertEqual(backfill['success_at'], NOW)
        self.assertEqual(backfill['status'], 'ok')
        self.assertEqual(backfill['last_deferred']['reason'], 'request_budget_exhausted')
        self.assertNotIn('2026-01-28', self.read('buzz_news_daily.json')['검색어'])
        resumed = FakeClient()
        _, used = self.execute(resumed, credentials={}, now=NOW + config.DAY + 1)
        self.assertEqual(used, 2)
        self.assertTrue(all('after:2026-01-28' in call[2]['params']['q'] or
                            'after:2026-01-27' in call[2]['params']['q'] for call in resumed.calls))

    def test_five_group_split_actual_requests_and_date_alignment(self):
        specs = [{'keyword': f'용어{i}', 'terms': [f'용어{i}', f'별칭{i}']} for i in range(12)]

        def handler(method, url, kwargs):
            if method != 'post':
                return None
            return Response({'results': [
                {'title': item['groupName'], 'data': [{'period': '2026-02-01' if index % 2 else '2026-01-31',
                                                     'ratio': 0 if index % 2 else 19.5}]}
                for index, item in reversed(list(enumerate(kwargs['json']['keywordGroups'])))]})

        client = FakeClient(handler, empty=True)
        result, _ = self.execute(client, specs=specs)
        posts = [call for call in client.calls if call[0] == 'post']
        self.assertEqual([len(call[2]['json']['keywordGroups']) for call in posts], [5, 5, 2])
        for post in posts:
            for group in post[2]['json']['keywordGroups']:
                self.assertEqual(len(group['keywords']), 2)
        datalab = result['naver']['datalab']
        self.assertEqual(datalab['dates'], ['2026-01-31', '2026-02-01'])
        self.assertEqual(datalab['series']['용어0'], [19.5, None])
        self.assertEqual(datalab['series']['용어1'], [None, 0])
        self.assertEqual(len(datalab['groups']), 3)
        second = FakeClient()
        self.execute(second, specs=specs, now=NOW + 1)
        self.assertEqual(second.calls, [])

    def test_datalab_current_window_is_not_spliced_into_old_normalization(self):
        first, _ = self.execute()
        first_points = deepcopy(first['naver']['datalab'])

        def renormalized(method, url, kwargs):
            if method == 'post':
                return Response({'results': [{'title': SPEC['keyword'], 'data': [
                    {'period': '2026-02-01', 'ratio': 10},
                    {'period': '2026-02-02', 'ratio': 100}]}]})
            return None

        second, _ = self.execute(FakeClient(renormalized), now=NOW + config.DAY)
        latest = second['naver']['datalab']
        self.assertEqual(latest['dates'], ['2026-02-01', '2026-02-02'])
        self.assertEqual(latest['series']['검색어'], [10, 100])
        events = [event for rows in HistoryArchive(self.root).events.values()
                  for event in rows if event['kind'] == 'datalab']
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]['data']['points']['검색어'], dict(zip(
            first_points['dates'], first_points['series']['검색어'])))
        self.assertEqual(events[1]['data']['points']['검색어'], {'2026-02-01': 10, '2026-02-02': 100})

    def test_optional_kakao_scope_keeps_valid_naver_counts_and_marks_failed_partial(self):
        result, _ = self.execute(credentials={'naver': CREDS['naver']})
        today = next(row for row in result['naver']['channel_daily']['검색어'] if row['date'] == '2026-02-01')
        self.assertEqual(today['cafe'], 1)
        self.assertEqual(today['total'], 3)
        self.assertEqual(today['scope']['cafe']['expected'], ['naver'])
        self.assertEqual(today['scope']['cafe']['observed'], ['naver'])
        self.assertEqual(today['scope']['cafe']['status'], 'complete')
        self.assertEqual(today['scope']['total']['status'], 'complete')
        failed = FakeClient(lambda method, url, kwargs: Response(status=503) if 'kakao.com' in url else None)
        result, _ = self.execute(failed, now=NOW + config.SIX_HOURS)
        today = next(row for row in result['naver']['channel_daily']['검색어'] if row['date'] == '2026-02-01')
        self.assertEqual(today['cafe'], 1)
        self.assertEqual(today['total'], 3)
        self.assertEqual(today['scope']['cafe']['expected'], ['naver', 'kakao'])
        self.assertEqual(today['scope']['cafe']['observed'], ['naver'])
        self.assertEqual(today['scope']['cafe']['status'], 'partial')
        self.assertEqual(today['scope']['total']['status'], 'partial')

        def kakao_today(method, url, kwargs):
            if 'kakao.com' in url:
                return Response({'meta': {'total_count': 1, 'is_end': True}, 'documents': [
                    {'url': 'https://scope/daum', 'title': '기쁨', 'datetime': '2026-02-01T01:00:00+09:00'}]})
            return None

        result, _ = self.execute(FakeClient(kakao_today), now=NOW + 2 * config.SIX_HOURS)
        today = next(row for row in result['naver']['channel_daily']['검색어'] if row['date'] == '2026-02-01')
        self.assertEqual(today['cafe'], 2)
        self.assertEqual(today['total'], 4)
        self.assertEqual(today['scope']['cafe']['components'], {'naver': 1, 'kakao': 1})
        self.assertEqual(today['scope']['cafe']['status'], 'complete')

    def test_error_preserves_successful_data_and_does_not_leak_exceptions(self):
        first, _ = self.execute()
        rows = self.word_daily()
        failed = FakeClient(lambda method, url, kwargs: Response(status=503))
        result, _ = self.execute(failed, now=NOW + config.DAY)
        for section in ('totals', 'related', 'sentiment', 'datalab', 'samples', 'history', 'hourly'):
            self.assertEqual(result['naver'][section], first['naver'][section], section)
        self.assertEqual(self.word_daily(), rows)
        for key, value in first['collection'].items():
            if 'success_at' in value:
                self.assertEqual(result['collection'][key]['success_at'], value['success_at'])
        client = FakeClient()
        self.execute(client, now=NOW + config.DAY + 1)
        self.assertEqual(client.calls, [])
        def raise_secret(method, url, kwargs):
            raise RuntimeError('secret must never appear')
        result, _ = self.execute(FakeClient(raise_secret), now=NOW + 2 * config.DAY)
        self.assertNotIn('secret must never appear', json.dumps(result))
        self.assertEqual(result['collection']['mentions:검색어:blog']['error'], 'transport_error')

    def test_429_stops_provider_and_honors_retry_after_across_runs(self):
        client = FakeClient(lambda method, url, kwargs:
                            Response(status=429, headers={'Retry-After': '90000'}) if 'naver.com' in url else None)
        result, _ = self.execute(client)
        self.assertEqual(len([call for call in client.calls if 'naver.com' in call[1]]), 1)
        self.assertEqual(result['collection']['mentions:provider:naver']['retry_after_at'], NOW + 90000)
        self.assertIsNone(result['naver']['totals']['검색어']['blog'])
        self.assertEqual(result['naver']['totals']['검색어']['daumcafe'], 7)
        client = FakeClient()
        self.execute(client, now=NOW + config.SIX_HOURS)
        self.assertFalse(any('naver.com' in call[1] for call in client.calls))
        client = FakeClient()
        self.execute(client, now=NOW + 90000)
        self.assertTrue(any('naver.com' in call[1] for call in client.calls))
        # An HTTP-date header, including Retry-After: 0, never triggers retries in-run.
        state = {}
        date_client = FakeClient(lambda method, url, kwargs: Response(
            status=429, headers={'Retry-After': 'Sun, 01 Feb 2026 15:00:00 GMT'}))
        http = collector.RequestBudget(date_client, state, 10, NOW)
        with self.assertRaises(collector.CollectionError):
            http.request('naver', 'get', 'https://test.invalid')
        self.assertEqual(state['mentions:provider:naver']['retry_after_at'], NOW + config.DAY)
        with self.assertRaises(collector.CollectionError):
            http.request('naver', 'get', 'https://test.invalid')
        self.assertEqual(len(date_client.calls), 1)

    def test_budget_does_not_spend_extra_requests_or_erase_success_status(self):
        first, _ = self.execute()
        client = FakeClient()
        result, count = self.execute(client, now=NOW + config.DAY, max_requests=1)
        self.assertEqual(count, 1)
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(result['naver']['totals'], first['naver']['totals'])
        self.assertEqual(result['collection']['mentions:검색어:news']['status'], 'ok')
        self.assertEqual(result['collection']['mentions:검색어:news']['success_at'], NOW)
        self.assertEqual(result['collection']['mentions:검색어:news']['last_deferred']['reason'], 'request_budget_exhausted')
        self.assertEqual(result['collection']['mentions:검색어:blog']['error'], 'request_budget_exhausted')

    def test_missing_credentials_and_true_zero_are_distinct(self):
        client = FakeClient(empty=True)
        result, count = self.execute(client, credentials={})
        self.assertEqual(count, 4)
        self.assertTrue(all('news.google.com' in call[1] for call in client.calls))
        self.assertEqual(result['collection']['mentions:검색어:blog']['status'], 'missing')
        self.assertIsNone(result['naver']['totals']['검색어']['blog'])
        self.assertIsNone(result['naver']['related']['검색어'])
        self.assertEqual(self.word_daily(), [])
        rows = {row['date']: row for row in result['naver']['channel_daily']['검색어']}
        self.assertEqual(rows['2026-02-01']['news'], 0)
        self.assertIsNone(rows['2026-02-01']['blog'])
        self.assertIsNone(rows['2026-02-01']['total'])
        self.assertIsNone(rows['2026-01-28']['news'])
        result, _ = self.execute(FakeClient(empty=True), now=NOW + config.DAY)
        self.assertEqual(result['naver']['totals']['검색어']['blog'], 0)
        self.assertEqual(result['naver']['related']['검색어'], [])
        self.assertEqual(self.word_daily()[0]['documents'], {'news': 0, 'blog': 0, 'cafe': 0})

    def test_pagination_limits_and_all_seen_page_not_an_end_signal(self):
        def handler(method, url, kwargs):
            if method != 'get' or 'news.google.com' in url:
                return None
            kakao = 'kakao.com' in url
            size = 50 if kakao else 100
            # A duplicate full page still requires the next page.
            item = {'url' if kakao else 'link': 'https://same/doc', 'title': '기쁨'}
            if not kakao and kwargs['params']['start'] == 201:
                item = {**item, 'link': 'https://new/third-page'}
            if kakao:
                return Response({'documents': [item] * size, 'meta': {'total_count': 1000, 'is_end': False}})
            return Response({'items': [item] * size, 'total': 1000})
        client = FakeClient(handler)
        result, _ = self.execute(client)
        for source, count in (('blog', 6), ('news', 2), ('cafearticle', 6)):
            calls = [call for call in client.calls if f'/{source}.json' in call[1]]
            self.assertEqual(len(calls), count)
            self.assertLessEqual(max(call[2]['params']['start'] for call in calls), 201)
        self.assertEqual(len([call for call in client.calls if 'kakao.com' in call[1]]), 4)
        self.assertEqual(result['naver']['samples']['검색어']['blog']['documents'], 2)
        self.assertEqual(sum(self.word_daily()[0]['documents'].values()), 2)

    def test_config_change_invalidates_cadence_without_losing_old_history(self):
        first, _ = self.execute()
        changed = {**SPEC, 'terms': [*SPEC['terms'], '새별칭']}
        client = FakeClient()
        with patch.object(config, 'CONFIG_HASH', 'new-config'):
            result, count = self.execute(client, specs=[changed], now=NOW + 1)
        self.assertGreater(count, 0)
        self.assertTrue(any(call[2].get('params', {}).get('query') == '새별칭' for call in client.calls))
        self.assertEqual(result['collection']['mentions:검색어:blog']['config_hash'], 'new-config')
        self.assertGreater(len(result['naver']['history']), len(first['naver']['history']))

    def test_zero_budget_is_byte_preserving_and_does_not_change_statuses(self):
        initial = {'naver': {'related': {'검색어': [{'w': '옛관측', 'c': 5}]},
                             'word_daily': {'검색어': [{'date': '2000-01-01', 'related': []}]}},
                   'collection': {'mentions:검색어:blog': {'status': 'ok', 'success_at': NOW}}}
        self.write('buzz.json', initial)
        self.write('buzz_news_daily.json', {'검색어': {'1999-01-01': 3}})
        before = {path.name: path.read_bytes() for path in self.root.iterdir()}
        client = FakeClient()
        result, used = self.execute(client, max_requests=0)
        self.assertEqual(result, initial)
        self.assertEqual(used, 0)
        self.assertEqual(client.calls, [])
        self.assertEqual({path.name: path.read_bytes() for path in self.root.iterdir()}, before)

    def test_legacy_bytes_every_file_and_histories_never_expire(self):
        old_date = '1999-01-01'
        seen = [f'https://old/{index}' for index in range(5001)]
        old = {
            'buzz.json': {'google': {'preserve': 42}, 'custom': [1],
                          'collection': {'google:untouched': {'status': 'ok'}},
                          'naver': {'custom': {'preserve': True}, 'word_daily': {'검색어': [{'date': old_date, 'related': [{'w': '옛', 'c': 1}]},
                                                                             {'date': '1999-01-02', 'basis': 'first_seen'}]}}},
            'buzz_naver_history.json': [{'date': old_date, 'totals': {'검색어': {'blog': 999}}}] * 121,
            'buzz_related_weeks.json': {'검색어': [{'key': str(i), 'label': 'legacy', 'items': []} for i in range(9)]},
            'buzz_hourly.json': {'검색어': [{'t': f'1999-01-01 {i:02}:00', 'blog': i} for i in range(17)]},
            'buzz_channel_daily.json': {'검색어': {'daily': {old_date: {'blog': 5, 'cafe': 4}}, 'sb': seen, 'sc': seen}},
            'buzz_news_daily.json': {'검색어': {old_date: 7}},
            'buzz_daum_daily.json': {'검색어': {old_date: 9}},
            'buzz_custom.json': {'arbitrary': ['all', 'old', 'observations']},
        }
        for name, value in old.items():
            self.write(name, value)
        raw = {name: (self.root / name).read_bytes() for name in old}
        result, _ = self.execute()
        self.assertEqual(result['google'], {'preserve': 42})
        self.assertEqual(result['collection']['google:untouched'], {'status': 'ok'})
        self.assertEqual(result['naver']['custom'], {'preserve': True})
        self.assertEqual(len(result['naver']['history']), 122)
        self.assertEqual(len(result['naver']['related_weeks']['검색어']), 10)
        self.assertEqual(len(result['naver']['hourly']['검색어']), 18)
        state = self.read('buzz_channel_daily.json')['검색어']
        self.assertEqual(state['daily'][old_date], {'blog': 5, 'cafe': 4})
        self.assertTrue(set(seen) <= set(state['sb']))
        self.assertTrue(set(seen) <= set(state['sc']))
        self.assertEqual(self.read('buzz_news_daily.json')['검색어'][old_date], 7)
        self.assertEqual(self.read('buzz_daum_daily.json')['검색어'][old_date], 9)
        # Legacy rows without an archive basis stay; archive-derived rows are not duplicated.
        self.assertEqual(result['naver']['word_daily']['검색어'], [{'date': old_date, 'related': [{'w': '옛', 'c': 1}]}])
        self.assertNotIn('word_daily_backfill', result['naver'])
        self.assertEqual([row['date'] for row in self.word_daily()], ['2026-02-01'])
        manifest = self.read('buzz_archive/legacy/manifest.json')['files']
        for name, content in raw.items():
            info = manifest[name]
            self.assertEqual(info['sha256'], hashlib.sha256(content).hexdigest())
            self.assertEqual((self.root / 'buzz_archive/legacy' / info['path']).read_bytes(), content)
        self.execute(now=NOW + config.DAY)
        self.assertEqual(self.read('buzz_archive/legacy/manifest.json')['files'], manifest)
        self.assertEqual((self.root / 'buzz_custom.json').read_bytes(), raw['buzz_custom.json'])

    def test_full_word_maps_seen_url_not_recounted_and_month_boundaries(self):
        vocabulary = ' '.join(f'단어{i}' for i in range(70))
        def initial(method, url, kwargs):
            if '/blog.json' in url:
                return Response({'total': 1, 'items': [{'link': 'https://revision/doc', 'title': vocabulary,
                                                       'description': '기쁨', 'postdate': '19990101'}]})
            return None
        before_midnight = NOW - 1
        with patch.dict(LEXICON, {f'단어{i}': 1 if i % 2 else -1 for i in range(70)}):
            first, _ = self.execute(FakeClient(initial), now=before_midnight)
        identifier = digest(['검색어', 'https://revision/doc'])[:16]
        archive = HistoryArchive(self.root)
        self.assertIn(identifier, archive.seen)
        self.assertEqual(archive.index['2026-01-31']['blog'], [identifier])
        self.assertTrue(archive.has('검색어', 'https://revision/doc#fragment'))
        first_rows = self.word_daily()
        old_row = {row['date']: row for row in first_rows}['2026-01-31']
        self.assertEqual(old_row['documents']['blog'], 1)
        self.assertGreater(len(old_row['related']), 24)
        self.assertGreater(len(old_row['sentiment']['blog']), 50)
        self.assert_compact_archive(vocabulary, '단어10 단어11')
        def revision(method, url, kwargs):
            if '/blog.json' in url:
                return Response({'total': 1, 'items': [{'link': 'https://revision/doc', 'title': '불안 수정',
                                                       'description': '', 'postdate': '19990101'}]})
            return None
        month_later = datetime(2026, 3, 1, 15, 0, tzinfo=timezone.utc).timestamp()
        result, _ = self.execute(FakeClient(revision), now=month_later)
        archive = HistoryArchive(self.root)
        # The already-seen URL keeps its first-seen attribution; changed content is not recounted.
        self.assertEqual([date for date, day in archive.index.items() if identifier in day.get('blog', [])],
                         ['2026-01-31'])
        self.assertFalse(any(event['kind'] in ('document', 'document_revision')
                             for rows in archive.events.values() for event in rows))
        words = {row['date']: row for row in self.word_daily()}
        self.assertEqual(words['2026-01-31'], old_row)
        self.assertEqual(words['2026-03-02']['documents']['blog'], 0)
        self.assertNotIn('수정', {row['w'] for row in words['2026-01-31']['related']})
        self.assertNotIn('수정', {row['w'] for row in words['2026-03-02']['related']})
        # The live sample summary still reflects the current content.
        self.assertIn('수정', {row['w'] for row in result['naver']['related']['검색어']})
        self.assertNotIn('1999-01-01', words)
        for name in ('words/2026-01-31.json', 'words/2026-03-02.json', 'index/2026-01-31.json',
                     'events-2026-01.json', 'events-2026-03.json'):
            self.assertTrue((self.root / 'buzz_archive' / name).exists(), name)
        self.assertFalse((self.root / 'buzz_archive/index/2026-03-02.json').exists())
        self.assert_compact_archive(vocabulary, '불안 수정')

    def test_analysis_failure_does_not_append_invalid_weekly_snapshot(self):
        self.write('buzz.json', {'naver': {'related': {'검색어': None}}})
        class BrokenKiwi:
            def tokenize(self, text):
                raise RuntimeError('analyzer unavailable')
        result, _ = collector.run(self.root, [SPEC], CREDS, FakeClient(), NOW,
                                  kiwi=BrokenKiwi(), lexicon=LEXICON)
        self.assertIsNone(result['naver']['related']['검색어'])
        self.assertEqual(result['naver']['related_weeks'], {})
        self.assertEqual(result['collection']['mentions:검색어:blog']['error'], 'analysis_unavailable')

    def test_malformed_success_does_not_become_zero_or_destroy_history(self):
        first, _ = self.execute()
        def malformed(method, url, kwargs):
            if method == 'post':
                return Response({'results': []})
            if 'news.google.com' in url:
                return Response(content=b'<html>upstream failure</html>')
            return Response({})
        result, _ = self.execute(FakeClient(malformed), now=NOW + config.DAY)
        for section in ('totals', 'related', 'sentiment', 'datalab', 'history'):
            self.assertEqual(result['naver'][section], first['naver'][section])
        self.assertEqual(result['collection']['rss:검색어']['error'], 'invalid_rss')

    def test_malformed_document_and_datalab_point_are_persisted_errors(self):
        first, _ = self.execute()

        def malformed(method, url, kwargs):
            if '/blog.json' in url:
                return Response({'total': 1, 'items': [{'link': 'https://invalid/title', 'title': 123}]})
            if method == 'post':
                return Response({'results': [{'title': SPEC['keyword'], 'data': [None]}]})
            return None

        result, _ = self.execute(FakeClient(malformed), now=NOW + config.DAY)
        self.assertEqual(result['naver']['totals']['검색어']['blog'], first['naver']['totals']['검색어']['blog'])
        self.assertEqual(result['naver']['datalab'], first['naver']['datalab'])
        self.assertEqual(result['collection']['mentions:검색어:blog']['error'], 'invalid_search_document')
        self.assertEqual([value['error'] for key, value in result['collection'].items()
                          if key.startswith('datalab:')], ['invalid_datalab_point'])

    def test_main_injected_clients_keys_clock_and_keyword_selection(self):
        selected = config.SPECS[0]
        client = FakeClient(empty=True)
        with patch('sys.stdout', new_callable=io.StringIO):
            result = collector.main(['--output-dir', str(self.root), '--keywords', selected['keyword'],
                                     '--max-requests', '4'], client=client, clock=lambda: NOW,
                                    kiwi=FakeKiwi(), credentials={}, lexicon=LEXICON)
        self.assertEqual(len(client.calls), 4)
        self.assertEqual(result['subjects'], config.SUBJECTS)
        self.assertEqual(result['config']['config_hash'], config.CONFIG_HASH)
        self.assertEqual(set(result['naver']['totals']), {selected['keyword']})
        with patch('sys.stderr', new_callable=io.StringIO), self.assertRaises(SystemExit):
            collector.main(['--keywords', 'not-a-canonical-keyword'], client=client, credentials={})

def dated(source, url, date, text='기쁨 소식'):
    """Provider-shaped fixture item published on a KST date."""
    compact = date.replace('-', '')
    if source == 'daumcafe':
        return {'url': url, 'title': text, 'contents': '', 'datetime': date + 'T10:00:00.000+09:00'}
    day = datetime.strptime(date, '%Y-%m-%d')
    return {'link': url, 'title': text, 'description': '', 'postdate': compact,
            'pubDate': day.strftime('%a, %d %b %Y') + ' 10:00:00 +0900'}


class PagedClient(FakeClient):
    """Serves per-(source, term) item lists with real provider pagination."""

    def __init__(self, items):
        super().__init__(self.serve)
        self.items = items

    def serve(self, method, url, kwargs):
        if method != 'get' or 'news.google.com' in url:
            return None
        params = kwargs['params']
        if 'kakao.com' in url:
            rows = self.items.get(('daumcafe', params['query']), [])
            page = rows[(params['page'] - 1) * 50: params['page'] * 50]
            return Response({'documents': page, 'meta': {'total_count': len(rows),
                                                         'is_end': params['page'] * 50 >= len(rows)}})
        source = {'blog': 'blog', 'news': 'news', 'cafearticle': 'cafe'}[url.rsplit('/', 1)[-1].split('.')[0]]
        rows = self.items.get((source, params['query']), [])
        start = params['start'] - 1
        return Response({'items': rows[start:start + params['display']], 'total': len(rows)})


class BackfillTests(OfflineCase):
    def fixture(self):
        items = {}
        for source in ('news', 'blog', 'daumcafe'):
            items[(source, '검색어')] = [dated(source, f'https://{source}/a', '2026-01-31'),
                                        dated(source, f'https://{source}/b', '2026-01-31', '불안 소식'),
                                        dated(source, f'https://{source}/c', '2026-01-29'),
                                        dated(source, f'https://{source}/old', '2026-01-20')]
            items[(source, '검색 어')] = [dated(source, f'https://{source}/a', '2026-01-31'),
                                         dated(source, f'https://{source}/d', '2026-01-30'),
                                         dated(source, f'https://{source}/old2', '2026-01-10')]
        items[('cafe', '검색어')] = [{'link': 'https://cafe/x', 'title': '카페', 'description': ''}]
        return items

    def test_counts_per_publication_date_dedupe_aliases_and_no_cafearticle(self):
        client = PagedClient(self.fixture())
        result, _ = self.execute(client, backfill_days=5)
        state = self.read('buzz_channel_daily.json')['검색어']
        daily = state['daily']
        # a is shared by both aliases -> counted once; 01-28/01-27 are true zeros (fully covered).
        self.assertEqual({date: daily[date].get('blog') for date in ('2026-01-31', '2026-01-30', '2026-01-29',
                                                                   '2026-01-28', '2026-01-27')},
                         {'2026-01-31': 2, '2026-01-30': 1, '2026-01-29': 1, '2026-01-28': 0, '2026-01-27': 0})
        self.assertNotIn('2026-01-26', daily)
        self.assertTrue(all('cafe' not in daily[date] for date in ('2026-01-31', '2026-01-28')))
        self.assertEqual(self.read('buzz_daum_daily.json')['검색어']['2026-01-31'], 2)
        self.assertEqual(state['backfill']['2026-01-31']['blog']['basis'], 'publication_date_backfill')
        self.assertEqual(state['backfill']['2026-01-31']['blog']['status'], 'complete')
        cafe_calls = [call for call in client.calls if 'cafearticle' in call[1]]
        # Only the regular sample (one short page per alias); cafearticle is never backfilled.
        self.assertEqual([call[2]['params']['start'] for call in cafe_calls], [1, 1])
        self.assertFalse(any('cafe' in value for value in state['backfill'].values()))
        rows = {row['date']: row for row in result['naver']['channel_daily']['검색어']}
        row = rows['2026-01-28']
        self.assertEqual((row['news'], row['blog'], row['cafe']), (0, 0, 0))
        self.assertEqual(row['scope']['backfill']['news']['provider'], 'naver_news')
        self.assertEqual(row['scope']['cafe']['observed'], ['kakao'])
        self.assertEqual(row['scope']['cafe']['status'], 'partial')
        self.assertEqual(row['scope']['total']['status'], 'partial')
        # RSS date counts (regular path) win over the Naver news backfill.
        self.assertEqual(rows['2026-01-31']['news'], 2)
        self.assertNotIn('news', rows['2026-01-31']['scope']['backfill'])
        self.assertIsNone(rows['2026-01-26']['blog'])
        self.assertEqual(result['backfill']['days'], 5)
        self.assertEqual(result['backfill']['requests'], {'naver': 4, 'kakao': 2})
        self.assertEqual(result['collection']['backfill:검색어:blog']['status'], 'complete')

    def test_truncated_depth_marks_boundary_partial_and_older_unknown(self):
        items = self.fixture()
        items[('blog', '검색어')] = ([dated('blog', f'https://blog/p1-{i}', '2026-01-31') for i in range(100)]
                                    + [dated('blog', f'https://blog/p2-{i}', '2026-01-30') for i in range(100)]
                                    + [dated('blog', 'https://blog/p3', '2026-01-29')])
        with patch.dict(collector.BACKFILL_PAGES, {'naver': 2}):
            result, _ = self.execute(PagedClient(items), backfill_days=5)
        state = self.read('buzz_channel_daily.json')['검색어']
        self.assertEqual(state['daily']['2026-01-31']['blog'], 101)
        self.assertEqual(state['daily']['2026-01-30']['blog'], 101)
        self.assertEqual(state['backfill']['2026-01-30']['blog'],
                         {**state['backfill']['2026-01-30']['blog'], 'status': 'partial',
                          'reason': 'search_depth', 'reached': '2026-01-30'})
        # Past the reached boundary the backfill stores nothing (01-29 may hold only the
        # regular sample's published-date observation; 01-28 stays unknown).
        self.assertNotIn('blog', state['backfill'].get('2026-01-29', {}))
        self.assertIsNone(state['daily'].get('2026-01-28', {}).get('blog'))
        rows = {row['date']: row for row in result['naver']['channel_daily']['검색어']}
        self.assertEqual(rows['2026-01-30']['scope']['total']['status'], 'partial')
        self.assertIsNone(rows['2026-01-28']['blog'])
        report = result['collection']['backfill:검색어:blog']
        self.assertEqual((report['status'], report['reached'], report['covered_from']),
                         ('partial', '2026-01-30', '2026-01-30'))

    def test_never_overwrites_existing_observations(self):
        self.write('buzz_channel_daily.json', {'검색어': {'daily': {'2026-01-29': {'blog': 99}}, 'sb': [], 'sc': []}})
        self.write('buzz_daum_daily.json', {'검색어': {'2026-01-29': 7}})
        self.write('buzz_news_daily.json', {'검색어': {'2026-01-28': 3}})
        result, _ = self.execute(PagedClient(self.fixture()), backfill_days=5, credentials=CREDS)
        state = self.read('buzz_channel_daily.json')['검색어']
        self.assertEqual(state['daily']['2026-01-29']['blog'], 99)
        self.assertNotIn('blog', state['backfill'].get('2026-01-29', {}))
        self.assertEqual(self.read('buzz_daum_daily.json')['검색어']['2026-01-29'], 7)
        self.assertNotIn('news', state['daily'].get('2026-01-28', {}))
        rows = {row['date']: row for row in result['naver']['channel_daily']['검색어']}
        self.assertEqual(rows['2026-01-28']['news'], 3)
        self.assertEqual(rows['2026-01-29']['blog'], 99)

    def test_document_index_prevents_first_seen_double_count_and_words_by_pub_date(self):
        client = PagedClient(self.fixture())
        runs = [lambda: self.execute(client, backfill_days=5),
                lambda: self.execute(PagedClient(self.fixture()), now=NOW + config.SIX_HOURS)]
        for run in runs:
            run()
            # Regular samples see only already-indexed URLs: no first-seen words today.
            today = {row['date']: row for row in self.word_daily()}['2026-02-01']
            self.assertEqual(today['basis'], 'first_seen')
            # Only out-of-window documents (old, old2, naver cafe x) are newly first seen;
            # the backfilled a-d are indexed and never re-counted, also not on the next run.
            self.assertEqual(today['documents'], {'news': 2, 'blog': 2, 'cafe': 3})
            state = self.read('buzz_channel_daily.json')['검색어']
            self.assertEqual(state['daily']['2026-01-31']['blog'], 2)
        words = {row['date']: row for row in self.word_daily_backfill()}
        row = words['2026-01-31']
        self.assertEqual(row['basis'], 'publication_date_backfill')
        self.assertEqual(row['documents'], {'news': 2, 'blog': 2, 'cafe': 2})
        self.assertEqual({item['w']: item['c'] for item in row['related']}, {'기쁨': 3, '소식': 6, '불안': 3})
        self.assertEqual(row['status'], {'news': 'complete', 'blog': 'complete', 'cafe': 'complete'})
        self.assertEqual(words['2026-01-28']['documents'], {'news': 0, 'blog': 0, 'cafe': 0})
        self.assertNotIn('2026-01-20', words)
        archive = HistoryArchive(self.root)
        identifier = digest(['검색어', 'https://blog/a'])[:16]
        # Indexed on the discovery date, while its words sit under the publication date.
        self.assertEqual([date for date, day in archive.index.items() if identifier in day.get('blog', [])],
                         ['2026-02-01'])
        self.assertEqual(sum(ids.count(identifier) for day in archive.index.values() for ids in day.values()), 1)
        self.assertNotIn('publication_date_backfill', archive.words['2026-02-01'].get('검색어', {}))
        self.assert_compact_archive('불안 소식')

    def test_previously_observed_documents_stay_in_first_seen_rows(self):
        self.execute(PagedClient(self.fixture()))
        result, _ = self.execute(PagedClient(self.fixture()), now=NOW + config.SIX_HOURS, backfill_days=5)
        first_seen = {row['date']: row for row in self.word_daily()}['2026-02-01']
        self.assertEqual(first_seen['documents']['blog'], 6)  # a,b,c,old,d,old2 from the regular run
        words = {row['date']: row for row in self.word_daily_backfill()}
        self.assertEqual(words['2026-01-31']['documents']['blog'], 0)
        self.assertEqual(words['2026-01-31']['previously_observed']['blog'], 2)
        self.assertEqual(words['2026-01-31']['status']['blog'], 'partial')

    def test_cli_validation_and_zero_default_makes_no_backfill_requests(self):
        for argv in (['--backfill-days', '32'], ['--backfill-days', '-1'], ['--backfill-max-requests', '-1']):
            with patch('sys.stderr', new_callable=io.StringIO), self.assertRaises(SystemExit):
                collector.main(argv, client=FakeClient(), credentials={})
        with self.assertRaises(ValueError):
            self.execute(backfill_days=32)
        result, _ = self.execute(PagedClient(self.fixture()))
        self.assertNotIn('backfill', result)
        self.assertFalse(any(key.startswith('backfill:') for key in result['collection']))
        selected = config.SPECS[0]
        client = PagedClient({})
        with patch('sys.stdout', new_callable=io.StringIO):
            result = collector.main(['--output-dir', str(self.root), '--keywords', selected['keyword'],
                                     '--backfill-days', '3', '--backfill-max-requests', '1',
                                     '--backfill-kakao-max-requests', '0'],
                                    client=client, clock=lambda: NOW + config.DAY, kiwi=FakeKiwi(),
                                    credentials=CREDS, lexicon=LEXICON)
        self.assertEqual(result['backfill']['requests'], {'naver': 1, 'kakao': 0})
        blog = result['collection'][f'backfill:{selected["keyword"]}:blog']
        self.assertEqual(blog['errors'], ['request_budget_exhausted'])


if __name__ == '__main__':
    unittest.main()

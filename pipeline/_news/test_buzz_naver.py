"""Offline executable contracts. Fake HTTP/Kiwi only; never live collectors."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
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


class CollectorTests(unittest.TestCase):
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
        word_day = naver['word_daily']['검색어'][0]
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
        self.assertEqual(second['naver']['word_daily'], first['naver']['word_daily'])
        third, count = self.execute(now=NOW + config.SIX_HOURS)
        self.assertEqual(count, 10)
        self.assertEqual(third['naver']['word_daily']['검색어'][0]['documents'], word_day['documents'])
        self.assertEqual(third['naver']['word_daily']['검색어'][0]['related'], word_day['related'])
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
        self.assertEqual([row['date'] for row in result['naver']['word_daily']['검색어']], ['2026-02-01'])
        result, _ = self.execute(now=NOW + config.DAY + config.SIX_HOURS - 1)
        self.assertEqual(len(result['naver']['word_daily']['검색어']), 2)
        self.assertEqual(result['naver']['word_daily']['검색어'][1]['date'], '2026-02-02')
        self.assertEqual(result['naver']['word_daily']['검색어'][1]['documents'], {'news': 0, 'blog': 0, 'cafe': 0})
        self.assertEqual(result['naver']['word_daily']['검색어'][1]['coverage'], ['blog', 'cafe', 'news'])

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
        failed = FakeClient(lambda method, url, kwargs: Response(status=503))
        result, _ = self.execute(failed, now=NOW + config.DAY)
        for section in ('totals', 'related', 'sentiment', 'datalab', 'samples', 'word_daily', 'history', 'hourly'):
            self.assertEqual(result['naver'][section], first['naver'][section], section)
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
        self.assertEqual(result['naver']['word_daily']['검색어'], [])
        rows = {row['date']: row for row in result['naver']['channel_daily']['검색어']}
        self.assertEqual(rows['2026-02-01']['news'], 0)
        self.assertIsNone(rows['2026-02-01']['blog'])
        self.assertIsNone(rows['2026-02-01']['total'])
        self.assertIsNone(rows['2026-01-28']['news'])
        result, _ = self.execute(FakeClient(empty=True), now=NOW + config.DAY)
        self.assertEqual(result['naver']['totals']['검색어']['blog'], 0)
        self.assertEqual(result['naver']['related']['검색어'], [])
        self.assertEqual(result['naver']['word_daily']['검색어'][0]['documents'], {'news': 0, 'blog': 0, 'cafe': 0})

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
        self.assertEqual(sum(result['naver']['word_daily']['검색어'][0]['documents'].values()), 2)

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
                          'naver': {'custom': {'preserve': True}, 'word_daily': {'검색어': [{'date': old_date, 'basis': 'first_seen'}]}}},
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
        self.assertIn(old_date, {row['date'] for row in result['naver']['word_daily']['검색어']})
        manifest = self.read('buzz_archive/legacy/manifest.json')['files']
        for name, content in raw.items():
            info = manifest[name]
            self.assertEqual(info['sha256'], hashlib.sha256(content).hexdigest())
            self.assertEqual((self.root / 'buzz_archive/legacy' / info['path']).read_bytes(), content)
        self.execute(now=NOW + config.DAY)
        self.assertEqual(self.read('buzz_archive/legacy/manifest.json')['files'], manifest)
        self.assertEqual((self.root / 'buzz_custom.json').read_bytes(), raw['buzz_custom.json'])

    def test_full_word_maps_document_revisions_and_month_boundaries(self):
        vocabulary = ' '.join(f'단어{i}' for i in range(70))
        def initial(method, url, kwargs):
            if '/blog.json' in url:
                return Response({'total': 1, 'items': [{'link': 'https://revision/doc', 'title': vocabulary,
                                                       'description': '기쁨', 'postdate': '19990101'}]})
            return None
        before_midnight = NOW - 1
        with patch.dict(LEXICON, {f'단어{i}': 1 if i % 2 else -1 for i in range(70)}):
            first, _ = self.execute(FakeClient(initial), now=before_midnight)
        archive = HistoryArchive(self.root)
        identifier = digest(['검색어', 'https://revision/doc'])
        old = deepcopy(archive.documents[identifier])
        self.assertEqual(old['first_seen']['kst'][:10], '2026-01-31')
        self.assertEqual(old['published_at'], '1999-01-01')
        self.assertGreater(len(old['related']), 24)
        self.assertGreater(len(old['sentiment']), 50)
        self.assertGreater(len(old['tokens']), 50)
        def revision(method, url, kwargs):
            if '/blog.json' in url:
                return Response({'total': 1, 'items': [{'link': 'https://revision/doc', 'title': '불안 수정',
                                                       'description': '', 'postdate': '19990101'}]})
            return None
        month_later = datetime(2026, 3, 1, 15, 0, tzinfo=timezone.utc).timestamp()
        result, _ = self.execute(FakeClient(revision), now=month_later)
        archive = HistoryArchive(self.root)
        document = archive.documents[identifier]
        self.assertEqual(document['first_seen'], old['first_seen'])
        self.assertNotEqual(document['content_hash'], old['content_hash'])
        self.assertIn('2026-01', archive.months)
        revisions = [event for rows in archive.events.values() for event in rows
                     if event['kind'] == 'document_revision' and event['data']['document']['id'] == identifier]
        self.assertEqual(len(revisions), 1)
        self.assertEqual(revisions[0]['data']['previous']['related'], old['related'])
        words = {row['date']: row for row in result['naver']['word_daily']['검색어']}
        self.assertEqual(words['2026-01-31']['documents']['blog'], 1)
        self.assertEqual(words['2026-01-31'], first['naver']['word_daily']['검색어'][0])
        self.assertEqual(words['2026-03-02']['documents']['blog'], 0)
        self.assertEqual(document['related'], {'불안': 1, '수정': 1})
        self.assertNotIn('수정', {row['w'] for row in words['2026-01-31']['related']})
        self.assertIn('수정', {row['w'] for row in result['naver']['related']['검색어']})
        self.assertNotIn('1999-01-01', words)
        self.assertTrue((self.root / 'buzz_archive/events-2026-01.json').exists())
        self.assertTrue((self.root / 'buzz_archive/events-2026-03.json').exists())

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


if __name__ == '__main__':
    unittest.main()

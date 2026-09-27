"""Offline collection contracts; no live HTTP, temporary staging outputs only."""
import builtins
import hashlib
import json
import tempfile
import sys
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import requests
import buzz_config as config
import fetch_buzz as worker


class Column:
    def __init__(self, values):
        self.values = values

    def tolist(self):
        return self.values


class Frame:
    def __init__(self, dates, columns):
        self.index = [datetime.strptime(date, '%Y-%m-%d') for date in dates]
        self.columns = columns

    def __len__(self):
        return len(self.index)

    def __getitem__(self, key):
        return Column(self.columns[key])


class Rows:
    def iterrows(self):
        return iter(enumerate([{'query': '관련 검색어', 'value': 80}]))


class FakeAPI:
    calls = []
    fail_payload = set()
    fail_aliases = set()
    fail_related = False
    dates = ['2026-09-20', '2026-09-22']
    rate_limit = False

    def __init__(self, budget):
        self.budget = budget
        self.payload = []

    def google_payload(self, expressions):
        self.budget.take('google')
        type(self).calls.append(('payload', expressions))
        self.payload = expressions
        if self.rate_limit:
            response = requests.Response()
            response.status_code = 429
            raise requests.HTTPError('Too Many Requests', response=response)
        if any(expression in self.fail_payload for expression in expressions):
            raise requests.Timeout('google timeout')

    def google_series(self):
        self.budget.take('google')
        type(self).calls.append(('series', self.payload))
        return Frame(self.dates, {expression: [10, 90] for expression in self.payload})

    def google_related(self, expression):
        self.budget.take('google')
        type(self).calls.append(('related', expression))
        if self.fail_related:
            raise requests.Timeout('related timeout')
        return {expression: {'top': Rows(), 'rising': Rows()}}

    def autocomplete(self, query):
        self.budget.take('autocomplete')
        type(self).calls.append(('autocomplete', query))
        if query in self.fail_aliases:
            raise requests.Timeout('autocomplete timeout')
        return ['공통 연관어', query + ' 제도']


def specs(count=6):
    return [{'keyword': '주제%d' % i, 'category': 'test',
             'terms': ['주제%d' % i, '주제 %d' % i],
             'search_query': '주제%d' % i, 'google_query': '주제%d' % i,
             'autocomplete_query': '주제%d' % i} for i in range(count)]


class GoogleTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='google-test-', dir=worker.ROOT)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.specs = specs()
        self.patch_config(self.specs, 'hash-a')
        FakeAPI.calls = []
        FakeAPI.fail_payload = set()
        FakeAPI.fail_aliases = set()
        FakeAPI.fail_related = False
        FakeAPI.rate_limit = False
        FakeAPI.dates = ['2026-09-20', '2026-09-22']
        network = patch.object(requests.sessions.Session, 'request', side_effect=AssertionError('network forbidden'))
        network.start()
        self.addCleanup(network.stop)

    def patch_config(self, values, digest):
        for name, value in {'SPECS': values, 'KEYWORDS': [s['keyword'] for s in values],
                            'CONFIG_HASH': digest,
                            'SUBJECTS': [{'id': 'test', 'label': 'test', 'keywords': [s['keyword'] for s in values]}]}.items():
            patcher = patch.object(config, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_collection(self, now=1000000, **kwargs):
        return worker.collect(self.root, now=now, api_class=FakeAPI, **kwargs)

    def write_old(self):
        old = {'updated': 'old-success', 'keywords': ['historical'],
               'subjects': [{'id': 'old', 'label': 'Historical', 'keywords': ['historical'], 'extra': {'a': 1}}],
               'keyword_config': {'unknown': {'keep': ['yes']}},
               'naver': {'nested': {'sentiment': [1, 2, 3]}, 'custom': 'retained'},
               'collection': {'naver:one': {'custom': {'attempt': 4}}},
               'unknown_top': {'nested': {'kept': True}},
               'trend': {'dates': ['2025-01-01', '2026-09-20'],
                         'series': {'주제0': [41, 42], '주제5': [51, 52], 'historical': [61, 62]},
                         'unknown': {'retained': True}},
               'related_google': {'주제0': {'top': [{'q': 'old', 'v': 1}], 'custom': {'keep': 2}}},
               'related_naver': {'주제0': ['old suggestion'], 'historical': ['old history']}}
        raw = (json.dumps(old, ensure_ascii=False, indent=4) + '\n\n').encode()
        (self.root / 'buzz.json').write_bytes(raw)
        return old, raw

    def test_reload_second_run_makes_zero_requests(self):
        first = self.run_collection()
        self.assertGreater(first['google_collection']['requests']['used'], 0)
        FakeAPI.calls = []
        second = self.run_collection(now=1000001)
        self.assertEqual(FakeAPI.calls, [])
        self.assertEqual(second['google_collection']['requests']['used'], 0)
        self.assertEqual(second['updated'], first['updated'])
        for state in second['collection'].values():
            self.assertEqual(state['attempted_at'], 1000000)
            self.assertEqual(state['success_at'], 1000000)

    def test_new_keyword_config_invalidates_guard(self):
        self.run_collection()
        self.patch_config(specs(7), 'hash-b')
        FakeAPI.calls = []
        result = self.run_collection(now=1000001)
        self.assertIn('주제6', result['trend']['series'])
        self.assertEqual(result['collection']['autocomplete:주제0']['config_hash'], 'hash-b')
        self.assertTrue(any('"주제6"' in expression for kind, payload in FakeAPI.calls
                            if kind == 'payload' for expression in payload))

    def test_five_item_limit_alias_payload_canonical_related_mapping(self):
        result = self.run_collection()
        payloads = [payload for kind, payload in FakeAPI.calls if kind == 'payload']
        self.assertEqual([len(payload) for payload in payloads], [5, 1])
        self.assertEqual(payloads[0][0], '"주제0" + "주제 0"')
        self.assertEqual(result['related_google']['주제0']['top'], [{'q': '관련 검색어', 'v': 80}])
        self.assertEqual(result['trend']['series']['주제0'], [10, 90])
        self.assertFalse(result['trend']['normalization']['comparable_across_batches'])
        snapshot = json.loads((self.root / result['google_archive']['google'][0]).read_text())
        self.assertEqual(snapshot['query_map']['"주제0" + "주제 0"'], '주제0')
        self.assertEqual(snapshot['terms']['주제0'], ['주제0', '주제 0'])

    def test_date_alignment_failed_batch_preservation_no_fabrication(self):
        old, _ = self.write_old()
        FakeAPI.fail_payload = {worker.google_expression(self.specs[5])}
        result = self.run_collection()
        self.assertEqual(result['trend']['dates'], ['2025-01-01', '2026-09-20', '2026-09-22'])
        self.assertEqual(result['trend']['series']['주제0'], [None, 10, 90])
        self.assertEqual(result['trend']['series']['주제5'], [51, 52, None])
        self.assertNotIn('2026-09-21', result['trend']['dates'])
        self.assertEqual(result['trend']['unknown'], old['trend']['unknown'])
        self.assertEqual(result['related_google']['주제0']['custom'], {'keep': 2})
        self.assertEqual(result['collection'][worker.batch_key(self.specs[5:])]['status'], 'error')

    def test_raw_bytes_and_all_old_nested_data_retained(self):
        old, raw = self.write_old()
        result = self.run_collection()
        digest = hashlib.sha256(raw).hexdigest()
        archive = self.root / 'buzz_archive' / 'legacy' / (digest + '.json')
        self.assertEqual(archive.read_bytes(), raw)
        self.assertEqual(json.loads(archive.read_text()), old)
        self.assertEqual(json.loads(archive.with_suffix('.source.json').read_text())['original_filename'], 'buzz.json')
        for name in ('naver', 'unknown_top'):
            self.assertEqual(result[name], old[name])
        self.assertEqual(result['collection']['naver:one'], old['collection']['naver:one'])
        self.assertEqual(result['keyword_config']['unknown'], {'keep': ['yes']})
        self.assertIn('historical', result['keywords'])
        self.assertEqual(result['subjects'][0], old['subjects'][0])

    def test_later_windows_do_not_stitch_normalization_scales(self):
        first = self.run_collection(keywords=['주제0'])
        refs = first['google_archive']['google'][:]
        originals = {ref: (self.root / ref).read_bytes() for ref in refs}
        FakeAPI.dates = ['2026-10-01', '2026-10-03']
        later = self.run_collection(now=1000000 + config.DAY, keywords=['주제0'])
        self.assertEqual(later['trend']['dates'], FakeAPI.dates)
        self.assertEqual(later['trend']['series']['주제0'], [10, 90])
        for ref, content in originals.items():
            self.assertIn(ref, later['google_archive']['google'])
            self.assertEqual((self.root / ref).read_bytes(), content)
        snapshot = json.loads(originals[refs[0]])
        self.assertEqual(snapshot['trend']['dates'], ['2026-09-20', '2026-09-22'])
        self.assertFalse(snapshot['normalization']['comparable_across_snapshots'])

    def test_google_429_stops_provider_persists_cooldown(self):
        first = self.run_collection()
        FakeAPI.calls = []
        FakeAPI.rate_limit = True
        failed = self.run_collection(now=1000000 + config.DAY)
        self.assertEqual(sum(kind == 'payload' for kind, _ in FakeAPI.calls), 1)
        self.assertEqual(failed['trend'], first['trend'])
        state = failed['collection'][worker.batch_key(self.specs[:5])]
        self.assertEqual(state['http_status'], 429)
        self.assertEqual(state['success_at'], 1000000)
        FakeAPI.calls = []
        self.run_collection(now=1000001 + config.DAY)
        self.assertEqual(FakeAPI.calls, [])

    def test_missing_dependency_is_error_not_empty_success(self):
        old, _ = self.write_old()
        original_import = builtins.__import__

        def missing(name, *args, **kwargs):
            if name.startswith('pytrends'):
                raise ModuleNotFoundError('No module named pytrends')
            return original_import(name, *args, **kwargs)

        with patch('builtins.__import__', side_effect=missing):
            with patch.object(worker.ProviderAPI, 'autocomplete', return_value=[]):
                result = worker.collect(self.root, keywords=['주제0'], now=1000000)
        state = result['collection'][worker.batch_key(self.specs[:1])]
        self.assertEqual(state['error_kind'], 'missing_dependency')
        self.assertNotIn('success_at', state)
        self.assertEqual(result['trend']['series'], old['trend']['series'])

    def test_autocomplete_alias_union_cached_per_query(self):
        self.specs[1]['terms'].append('주제 0')
        result = self.run_collection()
        queries = [query for kind, query in FakeAPI.calls if kind == 'autocomplete']
        expected = list(dict.fromkeys(term for spec in self.specs for term in spec['terms']))
        self.assertCountEqual(queries, expected)
        self.assertEqual(queries.count('주제 0'), 1)
        self.assertEqual(result['related_naver']['주제0'], ['공통 연관어', '주제0 제도', '주제 0 제도'])
        snapshot = json.loads((self.root / result['google_archive']['autocomplete'][0]).read_text())
        self.assertEqual(snapshot['observed_at'], worker.iso_time(1000000))

    def test_partial_autocomplete_preserves_prior_array(self):
        old, _ = self.write_old()
        FakeAPI.fail_aliases = {'주제 0'}
        result = self.run_collection(keywords=['주제0'])
        self.assertEqual(result['related_naver']['주제0'], old['related_naver']['주제0'])
        self.assertEqual(result['collection']['autocomplete:주제0']['status'], 'error')
        self.assertEqual(len(result['google_archive']['autocomplete']), 1)
        FakeAPI.calls = []
        self.run_collection(now=1000001, keywords=['주제0'])
        self.assertEqual(FakeAPI.calls, [])

    def test_partial_google_archived_but_failed_batch_not_published(self):
        old, _ = self.write_old()
        FakeAPI.fail_related = True
        FakeAPI.fail_aliases = {'주제0', '주제 0'}
        result = self.run_collection(keywords=['주제0'])
        self.assertEqual(result['trend']['series'], old['trend']['series'])
        self.assertEqual(result['updated'], 'old-success')
        self.assertEqual(len(result['google_archive']['google']), 1)
        self.assertEqual(result['collection'][worker.batch_key(self.specs[:1])]['status'], 'error')

    def test_request_cap_and_zero_budget_no_attempt_timestamp(self):
        result = self.run_collection(max_requests=2)
        self.assertEqual(result['google_collection']['requests']['used'], 2)
        self.assertEqual(len(FakeAPI.calls), 2)
        other = self.root / 'zero'
        FakeAPI.calls = []
        result = worker.collect(other, max_requests=0, api_class=FakeAPI, now=1000000)
        self.assertEqual(FakeAPI.calls, [])
        self.assertNotIn('updated', result)
        for status in result['collection'].values():
            self.assertNotIn('attempted_at', status)
            self.assertEqual(status['status'], 'deferred')

    def test_archive_failure_never_overwrites_payload(self):
        _, raw = self.write_old()
        with patch.object(worker, 'immutable_bytes', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.run_collection()
        self.assertEqual((self.root / 'buzz.json').read_bytes(), raw)
        self.assertEqual(FakeAPI.calls, [])

    def test_provider_adapter_counts_cookie_widgets_and_stops_exactly_at_cap(self):
        class LocalTrendReq:
            def __init__(self, **kwargs):
                self.options = kwargs
                self.GetGoogleCookie()

            def _get_data(self, *args, **kwargs):
                return requests.get('https://example.invalid/google', allow_redirects=False)

            def build_payload(self, expressions, **kwargs):
                self._get_data()
                self.expressions = expressions
                self.related_queries_widget_list = [
                    {'request': {'restriction': {'complexKeywordsRestriction': {
                        'keyword': [{'value': expression}]}}}} for expression in expressions]

            def interest_over_time(self):
                self._get_data()
                return Frame(FakeAPI.dates, {expression: [10, 90] for expression in self.expressions})

            def related_queries(self):
                result = {}
                for widget in self.related_queries_widget_list:
                    self._get_data()
                    expression = widget['request']['restriction']['complexKeywordsRestriction']['keyword'][0]['value']
                    result[expression] = {'top': Rows(), 'rising': Rows()}
                return result

        module = SimpleNamespace(TrendReq=LocalTrendReq)
        response = requests.Response()
        response.status_code = 200
        response.cookies.set('NID', 'test-only')
        with patch.dict(sys.modules, {'pytrends': SimpleNamespace(request=module), 'pytrends.request': module}):
            with patch.object(requests, 'get', return_value=response) as get:
                result = worker.collect(self.root, now=1000000, max_requests=4)
                self.assertEqual(get.call_count, 4)
                self.assertTrue(all(call.kwargs['allow_redirects'] is False for call in get.call_args_list))
        self.assertEqual(result['google_collection']['requests']['used'], 4)
        # Series and first related-query response survive the second widget's cap.
        self.assertEqual(len(result['google_archive']['google']), 2)
        snapshot = json.loads((self.root / result['google_archive']['google'][1]).read_text())
        self.assertEqual(list(snapshot['related_google']), ['주제0'])
        self.assertNotIn('updated', result)

    def test_autocomplete_429_stops_remaining_aliases_and_keywords(self):
        first = self.run_collection()
        response = requests.Response()
        response.status_code = 429

        def rate_limited(api, query):
            api.budget.take('autocomplete')
            raise requests.HTTPError('429', response=response)

        with patch.object(FakeAPI, 'autocomplete', rate_limited):
            failed = self.run_collection(now=1000000 + config.DAY)
        self.assertEqual(failed['google_collection']['requests']['autocomplete'], 1)
        self.assertEqual(failed['related_naver'], first['related_naver'])
        self.assertEqual(failed['collection']['autocomplete:주제0']['http_status'], 429)
        FakeAPI.calls = []
        self.run_collection(now=1000001 + config.DAY)
        self.assertEqual(FakeAPI.calls, [])

    def test_cli_bounds_reject_invalid_inputs_without_requests(self):
        with self.assertRaises(SystemExit):
            worker.main(['--max-requests', '501'])
        with self.assertRaises(SystemExit):
            worker.main(['--keywords', 'not-configured'])
        self.assertEqual(FakeAPI.calls, [])


if __name__ == '__main__':
    unittest.main()

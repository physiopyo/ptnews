import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests
import fetch_allied as allied


CREDENTIALS = {'id': 'fixture-id', 'secret': 'fixture-secret'}
PUB = 'Sun, 27 Sep 2026 00:00:00 GMT'


def response(body='', status=200, headers=None):
    result = requests.Response()
    result.status_code = status
    result._content = body.encode('utf-8')
    result.encoding = 'utf-8'
    result.headers.update(headers or {})
    return result


def rss_row(aid='one', title='약사 정책', **extra):
    return {'rawtitle': title, 'glink': 'https://news.google.com/rss/articles/' + aid,
            'pub': PUB, 'media': '', **extra}


def article(index=1, title='약사 정책', host='a.kr', **extra):
    return {'title': title, 'desc': '법안 논의', 'url': 'https://%s/news?id=%s' % (host, index),
            'topics': ['pharm'], 'chip': '매체', 'date': '2020-01-01',
            'dt': '2020-01-01T00:00:00+09:00', 'img': '', 'source': 'news-search', **extra}


class AlliedTests(unittest.TestCase):
    def setUp(self):
        # Fixture-only suite: an accidental real HTTP request must fail.
        self.addCleanup(patch.stopall)
        patch('requests.sessions.Session.request', side_effect=AssertionError('live HTTP forbidden')).start()
        patch('fetch_press.time.sleep').start()

    def test_four_mental_health_professions_spacing_and_particles(self):
        for profession in ('임상 심리사', '간호사', '사회 복지사', '작업 치료사'):
            term = '정신 건강 ' + profession
            for variant in (term, term.replace(' ', ''), '정신건강 ' + profession.replace(' ', '')):
                with self.subTest(term=variant):
                    self.assertEqual(allied.classify(variant + '들의 자격 정책 논의'), ['psych'])
        for term in ('심리상담사', '상담심리사', '임상심리사', '정신건강 전문요원'):
            self.assertEqual(allied.classify(term + '에게 업무범위 정책 적용'), ['psych'])

    def test_general_jobs_need_mental_or_counseling_context(self):
        for job in ('간호사', '사회복지사', '작업치료사'):
            self.assertEqual(allied.classify(job + ' 병원 고용 정책'), [])
            self.assertEqual(allied.classify(job + ' 정신건강 정책'), ['psych'])
            self.assertEqual(allied.classify(job + ' 상담 정책 참여'), ['psych'])
        for title in ('계약사항 정책 변경', '예약사항 안전 안내', '주식 정책 발표',
                      '식약처 식품 안전 정책', '보건복지부 시설 안전 점검', '국립정신건강센터 화재 안전 점검'):
            self.assertEqual(allied.classify(title), [], title)

    def test_programs_organizations_and_pharmacy_policies(self):
        for title in ('전국민 마음투자 지원사업 정책 개편', '전 국민 마음 투자 지원 사업 개선',
                      '정신건강 심리상담 바우처사업 시행', '정신건강복지법 시행령 개정',
                      '한국심리학회 자격 법제화', '국립정신건강센터 전문요원 수련 정책'):
            self.assertEqual(allied.classify(title), ['psych'], title)
        for title in ('약 배송 플랫폼 규제', '성분명처방 정책 논의', '대체 조제 제도 개편',
                      '의약품 수급 대책', '공적전자처방전 정책 논의', '약사법 개정 법안'):
            self.assertEqual(allied.classify(title), ['pharm'], title)
        self.assertEqual(allied.classify('약사와 상담심리사 직역 정책'), ['psych', 'pharm'])
        self.assertEqual(allied.classify('국회 정책 논의', '약사 처우 개선'), ['pharm'])

    def test_promotion_filter_preserves_policy_debate(self):
        for title in ('심리상담사 자격증 취득 무료수강', '약국 특가 구매 이벤트'):
            self.assertEqual(allied.classify(title), [])
        for title in ('심리상담사 민간자격 자격증 취득 광고 논란', '심리상담사 무료수강 지원 정책 논의'):
            self.assertEqual(allied.classify(title), ['psych'])
        self.assertEqual(allied.classify('약 배송 할인 쿠폰 규제 정책'), ['pharm'])
        self.assertEqual(allied.classify('약사 정책', url='https://blog.naver.com/x'), [])

    def test_url_identity_matches_ui_scheme_and_stable_parameter_order(self):
        self.assertNotEqual(allied.url_key('https://a.kr/a?idxno=1'), allied.url_key('https://b.kr/a?idxno=1'))
        self.assertNotEqual(allied.url_key('https://a.kr/a?id=1'), allied.url_key('https://a.kr/a?id=2'))
        self.assertNotEqual(allied.url_key('http://a.kr/a?id=1'), allied.url_key('https://a.kr/a?id=1'))
        self.assertEqual(allied.url_key('https://WWW.a.kr:443/a?z=3&id=2&id=1&utm_source=x&gclid=y#s'),
                         'https://a.kr/a?id=2&id=1&z=3')
        self.assertNotEqual(allied.url_key('https://a.kr/a?id=1&section=2'), allied.url_key('https://a.kr/a?id=1&section=3'))
        self.assertEqual(allied.url_key('https://a.kr?q=~*'), 'https://a.kr/?q=%7E*')

    def test_missing_credentials_and_official_api_contract(self):
        session = Mock()
        for credentials in (None, {}, {'id': 'x'}, {'id': '', 'secret': 'x'}, {'id': 'x', 'secret': None}):
            self.assertEqual(allied.naver_news(session, '약사', credentials), [])
        session.get.assert_not_called()
        session.get.return_value = response(json.dumps({'items': [{'title': '<b>약사</b> 정책',
            'originallink': 'https://a.kr/1', 'description': '처우 개선', 'pubDate': PUB}]}))
        rows = allied.naver_news(session, '약사', CREDENTIALS, start=101)
        self.assertEqual(rows[0]['title'], '약사 정책')
        self.assertEqual(rows[0]['pub'], PUB)
        self.assertEqual(session.get.call_args.args[0], 'https://openapi.naver.com/v1/search/news.json')
        self.assertEqual(session.get.call_args.kwargs['params'], {'query': '약사', 'display': 100, 'start': 101, 'sort': 'date'})

    def test_shared_approved_keywords_drive_queries(self):
        for spec in allied.SPECS:
            if spec['subject'] in allied.TOPICS:
                self.assertIn(allied.SEARCH_CONTEXT.get(spec['keyword'], spec['keyword']), allied.QUERIES[spec['subject']])

    @patch.object(allied, 'fetch_meta', return_value={'title': '약사와 상담심리사 직역 정책', 'desc': '법안 논의', 'site': '매체'})
    @patch.object(allied, 'decode_gnews', return_value='https://a.kr/news?id=1')
    @patch.object(allied, 'gnews_rss', return_value=[rss_row()])
    def test_duplicate_decode_and_metadata_are_cached(self, rss, decode, meta):
        rows = allied.collect(Mock(), keywords=['약사', '심리상담'])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['topics'], ['psych', 'pharm'])
        self.assertEqual(rows[0]['date'], '2026-09-27')
        self.assertEqual(rows[0]['dt'], '2026-09-27T09:00:00+09:00')
        decode.assert_called_once()
        meta.assert_called_once()

    @patch.object(allied, 'fetch_meta')
    @patch.object(allied, 'decode_gnews')
    @patch.object(allied, 'gnews_rss', return_value=[rss_row(title='상담심리사 정책')])
    def test_known_alias_avoids_decode_fetch_and_unions_evidence(self, rss, decode, meta):
        known = article(search_urls=[rss_row()['glink']])
        rows = allied.collect(Mock(), known=[known], keywords=['심리상담'])
        decode.assert_not_called()
        meta.assert_not_called()
        self.assertEqual(rows[0]['topics'], ['psych', 'pharm'])
        self.assertEqual(allied.article_topics(rows[0]), ['psych', 'pharm'])

    @patch.object(allied, 'fetch_meta', return_value={'title': '약사 정책'})
    @patch.object(allied, 'decode_gnews', side_effect=['https://a.kr/news?id=1', 'https://b.kr/news?id=1'])
    @patch.object(allied, 'gnews_rss', return_value=[rss_row('a'), rss_row('b')])
    def test_identical_titles_and_ids_on_different_hosts_stay_separate(self, rss, decode, meta):
        rows = allied.collect(Mock(), keywords=['약사'])
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]['url'], rows[1]['url'])

    @patch.object(allied, 'gnews_rss', return_value=[])
    @patch.object(allied, 'fetch_meta', return_value={'title': '약사 정책'})
    @patch.object(allied, 'naver_news')
    def test_naver_two_pages_and_known_overlap(self, naver, meta, rss):
        first = [article(i) for i in range(100)]
        naver.side_effect = [first, [article(100)]]
        self.assertEqual(len(allied.collect(Mock(), CREDENTIALS, keywords=['약사'])), 101)
        self.assertEqual([call.kwargs['start'] for call in naver.call_args_list], [1, 101])
        naver.reset_mock(side_effect=True)
        meta.reset_mock()
        naver.return_value = first
        self.assertEqual(len(allied.collect(Mock(), CREDENTIALS, known=first, keywords=['약사'])), 100)
        naver.assert_called_once()
        meta.assert_not_called()

    @patch.object(allied, 'gnews_rss', return_value=[rss_row(str(i)) for i in range(10)])
    @patch.object(allied, 'decode_gnews', return_value='https://a.kr/news?id=1')
    @patch.object(allied, 'fetch_meta', return_value={'title': '약사 정책'})
    def test_candidate_budget_bounds_decode_work(self, meta, decode, rss):
        report = {}
        allied.collect(Mock(), keywords=['약사', '약국'], max_candidates=2, report=report)
        self.assertEqual(decode.call_count, 2)
        meta.assert_called_once()
        rss.assert_called_once()
        self.assertEqual(report['stop_reason'], 'candidate_budget')

    def test_request_budget_includes_decode_and_stops(self):
        session = Mock()
        session.get.return_value = response('<rss><channel><item><title>약사 정책</title>'
            '<link>https://news.google.com/rss/articles/one</link></item></channel></rss>')
        report = {}
        rows = allied.collect(session, keywords=['약사', '약국'], max_requests=1, report=report)
        self.assertEqual(rows, [])
        session.get.assert_called_once()
        session.post.assert_not_called()
        self.assertEqual(report['requests'], 1)
        self.assertEqual(report['stop_reason'], 'request_budget')
        self.assertEqual(report['candidates'][0]['status'], 'candidate')
        self.assertEqual(report['candidates'][0]['reason'], 'decode_unavailable')

    def test_fixture_end_to_end_rss_decode_metadata_and_budget(self):
        session, report = Mock(), {}
        session.get.side_effect = [
            response('<rss><channel><item><title>약사 정책</title>'
                     '<link>https://news.google.com/rss/articles/one</link></item></channel></rss>'),
            response('<div data-n-a-sg="fixture" data-n-a-ts="1"></div>'),
            response('<html><meta property="og:title" content="약사와 상담심리사 정책">'
                     '<meta property="og:description" content="법안 논의">'
                     '<meta property="article:published_time" content="2026-09-27T09:00:00+09:00"></html>'),
        ]
        session.post.return_value = response(json.dumps([
            ['wrb.fr', 'Fbv4je', json.dumps(['garturlres', 'https://a.kr/news?id=1'])]
        ]))
        rows = allied.collect(session, keywords=['약사', '심리상담'], max_requests=4, report=report)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['topics'], ['psych', 'pharm'])
        self.assertEqual(rows[0]['retrieval_status'], 'retrieved')
        self.assertEqual(rows[0]['date'], '2026-09-27')
        self.assertEqual(report['requests'], 4)
        self.assertEqual(session.get.call_count, 3)
        session.post.assert_called_once()

    def test_rate_limit_stops_source_without_disclosing_credentials(self):
        session = Mock()
        session.get.return_value = response('rate limited', 429, {'Retry-After': '120'})
        report = {}
        self.assertEqual(allied.collect(session, keywords=['약사', '약국'], report=report), [])
        session.get.assert_called_once()
        self.assertEqual(report['sources']['google']['status'], 'rate_limited')
        self.assertEqual(report['sources']['google']['retry_after'], '120')
        self.assertEqual(report['sources']['google']['backoff'], 'stop_for_run')
        self.assertEqual(report['sources']['naver']['status'], 'missing_credentials')
        self.assertNotIn(CREDENTIALS['secret'], json.dumps(report))

    def test_rss_failure_is_distinct_from_empty_result(self):
        for body, expected in (('<rss><channel /></rss>', 'empty'), ('<html>blocked</html>', 'error'), ('broken', 'error')):
            session, report = Mock(), {}
            session.get.return_value = response(body)
            allied.collect(session, keywords=['약사'], report=report)
            self.assertEqual(report['queries'][0]['status'], expected)

    def test_redirects_count_against_budget_and_api_never_forwards_auth(self):
        session, report = Mock(), {}
        session.get.return_value = response('', 302, {'Location': 'https://b.kr/news'})
        http = allied.RequestBudget(session, 1, report)
        http.source = 'metadata'
        with self.assertRaises(requests.RequestException):
            http.get('https://a.kr/news')
        session.get.assert_called_once()
        self.assertEqual(report['requests'], 1)
        session.reset_mock()
        http = allied.RequestBudget(session, 5, {})
        http.source = 'naver'
        with self.assertRaises(requests.RequestException):
            allied.naver_news(http, '약사', CREDENTIALS)
        session.get.assert_called_once()

    @patch.object(allied, 'gnews_rss', return_value=[rss_row()])
    @patch.object(allied, 'decode_gnews', return_value='https://a.kr/news?id=1')
    @patch.object(allied, 'fetch_meta', return_value=None)
    def test_unretrievable_article_remains_candidate_not_published(self, meta, decode, rss):
        report = {}
        self.assertEqual(allied.collect(Mock(), keywords=['약사'], report=report), [])
        self.assertEqual(report['candidates'][0]['reason'], 'metadata_unavailable')
        self.assertEqual(report['candidates'][0]['topics'], ['pharm'])

    def test_offline_cli_retains_all_history_reclassifies_and_audits_invalid(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            old = [article(i) for i in range(301)]
            joint = article(999, title='약사와 정신건강간호사 정책')
            invalid = article(1000, title='계약사항 정책 변경', desc='', user_note='must survive')
            (path / 'pharm.json').write_text(json.dumps(old + [joint, invalid]), encoding='utf-8')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                report = allied.main(['--output-dir', directory, '--topic', 'psych', '--max-requests', '0'])
            pharm = json.loads((path / 'pharm.json').read_text(encoding='utf-8'))
            psych = json.loads((path / 'psych.json').read_text(encoding='utf-8'))
            audit = json.loads((path / 'allied_rejected.json').read_text(encoding='utf-8'))
            self.assertEqual(len(pharm), 302)
            self.assertEqual(psych[0]['topics'], ['psych', 'pharm'])
            self.assertEqual(audit[0]['article'], invalid)
            self.assertEqual(report['requests'], 0)
            self.assertTrue(all(row['dt'].startswith('2020') for row in pharm))
            with contextlib.redirect_stdout(io.StringIO()):
                allied.main(['--output-dir', directory, '--keywords', '약사', '--max-requests', '0'])
            self.assertEqual(len(json.loads((path / 'allied_rejected.json').read_text(encoding='utf-8'))), 1)
            self.assertEqual(len(json.loads((path / 'pharm.json').read_text(encoding='utf-8'))), 302)

    @patch.object(allied, 'gnews_rss', side_effect=requests.ConnectionError('fixture transport failure'))
    def test_failed_collection_preserves_previously_accepted(self, rss):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'pharm.json'
            old = article(user_note='retain custom field')
            path.write_text(json.dumps([old]), encoding='utf-8')
            with patch.dict('os.environ', {'NAVER_ID': 'fixture', 'NAVER_SECRET': 'fixture'}), \
                 patch.object(allied, 'naver_news', side_effect=requests.ConnectionError('fixture failure')), \
                 contextlib.redirect_stdout(io.StringIO()):
                report = allied.main(['--output-dir', directory, '--keywords', '약사'])
            self.assertEqual(json.loads(path.read_text(encoding='utf-8')), [old])
            self.assertEqual(report['sources']['google']['status'], 'error')
            self.assertEqual(report['sources']['naver']['status'], 'error')


if __name__ == '__main__':
    unittest.main()

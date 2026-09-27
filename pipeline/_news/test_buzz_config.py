"""Offline collection-contract tests; no credentials, network, or model calls."""
import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
import buzz_config as config


class ConfigTests(unittest.TestCase):
    def test_original_keywords_and_expansion(self):
        self.assertEqual(config.KEYWORDS[:5], ['도수치료', '관리급여', '실손보험', '체외충격파', '물리치료사'])
        required = {
            '정신건강임상심리사', '정신건강간호사', '정신건강사회복지사', '정신건강작업치료사',
            '공적 전자처방전', '심리상담사법', '심리상담 수련', '심리상담 자격',
            '한국임상심리학회', '한국심리학회', '한국상담학회', '한국상담심리학회',
            '약사회', '비대면진료 플랫폼', '약국 플랫폼', '전국민 마음건강',
            '정신건강전문요원 업무범위', '정신건강복지법 시행령',
        }
        self.assertFalse(required - set(config.KEYWORDS))
        self.assertEqual(len(set(config.KEYWORDS)), len(config.KEYWORDS))
        terms = {term for spec in config.SPECS for term in spec['terms']}
        self.assertFalse({'심리 상담', '약 배달', '약배달', '전 국민 마음투자 지원사업',
                          '심리상담 공통업무화', '정신건강 심리상담 바우처'} - terms)

    def test_provider_limits_and_alias_budget(self):
        groups = config.batches(config.SPECS)
        self.assertEqual([spec for group in groups for spec in group], config.SPECS)
        self.assertTrue(all(len(group) <= 5 for group in groups))
        self.assertTrue(all(1 <= len(s['terms']) <= 20 for s in config.SPECS))
        self.assertTrue(all(s['keyword'] == s['search_query'] for s in config.SPECS))
        self.assertGreater(sum(len(s['terms']) for s in config.SPECS), len(config.SPECS))
        with self.assertRaises(ValueError):
            config.batches(config.SPECS, 6)

    def test_six_hour_and_daily_budgets(self):
        status = config.record({}, True, now=1000)
        self.assertFalse(config.due(status, config.SIX_HOURS, now=22599))
        self.assertTrue(config.due(status, config.SIX_HOURS, now=22600))
        self.assertFalse(config.due(status, config.DAY, now=22600))
        self.assertTrue(config.due(status, config.DAY, now=87400))

    def test_changed_config_invalidates_freshness(self):
        status = config.record({}, True, now=1000)
        with patch.object(config, 'CONFIG_HASH', 'changed'):
            self.assertTrue(config.due(status, config.DAY, now=1001))

    def test_failure_preserves_success_and_throttles_retries(self):
        status = config.record({}, True, now=1000)
        failed = config.record(status, False, 'Timeout', now=22600)
        self.assertEqual(failed['success_at'], 1000)
        self.assertEqual(failed['status'], 'error')
        self.assertFalse(config.due(failed, config.SIX_HOURS, now=22601))
        recovered = config.record(failed, True, now=44200)
        self.assertNotIn('error', recovered)
        self.assertEqual(recovered['success_at'], 44200)

    def test_invalid_stored_json_is_not_silently_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'buzz.json'
            target.write_text('{bad', encoding='utf-8')
            with self.assertRaises(json.JSONDecodeError):
                config.load(target)
            self.assertEqual(target.read_text(), '{bad')

    def test_atomic_save_and_absent_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'buzz.json'
            self.assertEqual(config.load(target, []), [])
            config.save(target, {'이력': [1, 2]})
            config.save(target, {'이력': [1, 2, 3]})
            self.assertEqual(config.load(target), {'이력': [1, 2, 3]})
            self.assertEqual(list(Path(tmp).glob('*.tmp')), [])


if __name__ == '__main__':
    unittest.main()

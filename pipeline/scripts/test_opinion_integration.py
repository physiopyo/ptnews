import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('ci', ROOT / 'pipeline/autoupdate_ci.py')
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class IntegrationTests(unittest.TestCase):
    def test_scheduled_path_runs_allied_news_and_persisted_collectors(self):
        calls = []
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {}, clear=True), \
             patch.object(ci, 'PIPE', tmp), patch.object(ci, 'write_keys'), patch.object(ci, 'remove_keys') as cleanup, \
             patch.object(ci, 'sync_output') as sync, patch.object(ci, 'log'), \
             patch.object(ci, 'run', side_effect=lambda args, label='', must=False: calls.append((args,label,must)) or 0):
            ci.main()
        names = [call[1] for call in calls]
        self.assertLess(names.index('allied-news'), names.index('buzz-google'))
        self.assertLess(names.index('buzz-google'), names.index('buzz-naver'))
        self.assertEqual(names[-1], 'build')
        self.assertTrue(calls[-1][2])
        cleanup.assert_called_once(); sync.assert_called_once()

    def test_build_only_does_not_run_collectors(self):
        calls = []
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'SKIP_FETCH':'1'}, clear=True), \
             patch.object(ci, 'PIPE', tmp), patch.object(ci, 'write_keys'), patch.object(ci, 'remove_keys'), \
             patch.object(ci, 'sync_output'), patch.object(ci, 'log'), \
             patch.object(ci, 'run', side_effect=lambda args, label='', must=False: calls.append(label) or 0):
            ci.main()
        self.assertEqual(calls, ['build'])

    def test_secret_cleanup_preserves_keyword_catalog(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(ci, 'NEWS', tmp):
            for name in ('naver_key.json','kakao_key.json','buzz_keywords.json','buzz.json'):
                (Path(tmp)/name).write_text('{}')
            ci.remove_keys()
            self.assertFalse((Path(tmp)/'naver_key.json').exists())
            self.assertFalse((Path(tmp)/'kakao_key.json').exists())
            self.assertTrue((Path(tmp)/'buzz_keywords.json').exists())
            self.assertTrue((Path(tmp)/'buzz.json').exists())
        workflow = (ROOT/'.github/workflows/autoupdate.yml').read_text()
        self.assertIn('rm -f pipeline/_news/naver_key.json pipeline/_news/kakao_key.json', workflow)
        self.assertNotIn('rebase -X', workflow)
        self.assertNotIn('reset --soft', workflow)
        self.assertRegex(workflow, r'actions/checkout@v4\n\s+with:\n\s+ref: master\n', 'queued runs must build from the current master tip')

    def test_git_tracks_catalog_and_excludes_actual_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(['git','init','-q',tmp],check=True)
            (Path(tmp)/'.gitignore').write_text((ROOT/'.gitignore').read_text())
            for name,expected in [('buzz_keywords.json',1),('naver_key.json',0),('kakao_key.json',0)]:
                result=subprocess.run(['git','-C',tmp,'check-ignore','-q','pipeline/_news/'+name])
                self.assertEqual(result.returncode,expected,name)

    def test_partial_key_creation_is_always_cleaned(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(ci, 'NEWS', tmp), \
             patch.object(ci, 'PIPE', tmp), patch.object(ci, 'log'):
            def incomplete_write():
                (Path(tmp)/'naver_key.json').write_text('fixture only')
                raise OSError('simulated second-file failure')
            with patch.object(ci, 'write_keys', side_effect=incomplete_write):
                with self.assertRaises(OSError):
                    ci.main()
            self.assertFalse((Path(tmp)/'naver_key.json').exists())


if __name__ == '__main__':
    unittest.main()

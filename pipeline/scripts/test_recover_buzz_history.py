import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('recover', Path(__file__).with_name('recover-buzz-history.py'))
recover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recover)


class RecoveryTests(unittest.TestCase):
    def test_current_bytes_and_revisions_are_both_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            data = source / 'pipeline/_news'
            data.mkdir(parents=True)
            file = data / 'buzz.json'
            first = b'{"legacy":1}\r\n'
            file.write_bytes(first)
            one = recover.backup_current(source, root / 'archive')
            self.assertEqual((root / 'archive' / one[0]['copy']).read_bytes(), first)
            file.write_bytes(b'{"legacy":2}\n')
            two = recover.backup_current(source, root / 'archive')
            self.assertNotEqual(one[0]['copy'], two[0]['copy'])
            self.assertEqual((root / 'archive' / one[0]['copy']).read_bytes(), first)
            self.assertEqual(file.read_bytes(), b'{"legacy":2}\n')

    def test_display_selects_latest_snapshot_without_adding_counts(self):
        def entry(oid, timestamp):
            return {'path':'pipeline/_news/buzz.json','blob':oid,'observations':[{'commit':oid,'committed_at':timestamp}]}
        entries = [entry('a','2026-07-01T09:00:00+09:00'),entry('b','2026-07-01T15:00:00+09:00'),entry('c','2026-07-01T23:30:00+00:00')]
        raws = []
        for i,e in enumerate(entries):
            payload = {'updated':'2026-07-01 08:00','naver':{'sentiment':{'도수치료':{'community':[{'w':'좋다','c':i+1,'p':1}]}},'channel_daily':{'도수치료':[{'date':'2026-04-01','news':i+1}]}}}
            raws.append((e,json.dumps(payload,ensure_ascii=False).encode()))
        with patch.object(recover,'read_blobs',return_value=iter(raws)):
            data = recover.projection(Path('/unused'),entries)
        rows=data['naver']['legacy_snapshots']['도수치료']
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]['sentiment']['community'][0]['c'],2)
        self.assertEqual(rows[0]['recorded_at'],'2026-07-01T15:00:00+09:00')
        self.assertEqual(rows[1]['recorded_at'],'2026-07-02T08:30:00+09:00')
        self.assertEqual(rows[0]['basis'],'git_saved_snapshot_not_publication_date')
        self.assertEqual(data['naver']['channel_daily']['도수치료'][0]['date'],'2026-04-01')
        self.assertEqual(data['naver']['channel_daily']['도수치료'][0]['news'],3)


if __name__ == '__main__':
    unittest.main()

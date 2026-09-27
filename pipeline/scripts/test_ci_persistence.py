"""Synthetic local Git repositories only; no product commits or network pushes."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('persist-ci-results.sh')


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.repo, self.remote = root/'run', root/'remote.git'
        self.env = {**os.environ, 'GIT_CONFIG_GLOBAL':os.devnull, 'GIT_CONFIG_NOSYSTEM':'1',
                    'GITHUB_RUN_ID':'123', 'GITHUB_RUN_ATTEMPT':'1'}
        self.git(root, 'init','--bare','--initial-branch=master',str(self.remote))
        self.git(root, 'init','--initial-branch=master',str(self.repo))
        self.identity(self.repo)
        (self.repo/'data.json').write_text('old observation')
        self.git(self.repo,'add','data.json'); self.git(self.repo,'commit','-m','fixture baseline')
        self.git(self.repo,'remote','add','origin',str(self.remote))
        self.git(self.repo,'push','-u','origin','master')
        (self.repo/'data.json').write_text('new observation')

    def git(self, cwd, *args):
        return subprocess.run(['git',*args],cwd=cwd,env=self.env,check=True,text=True,
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout.strip()

    def identity(self, repo):
        self.git(repo,'config','user.name','Fixture')
        self.git(repo,'config','user.email','fixture@example.invalid')

    def persist(self, build_ok):
        return subprocess.run(['bash',str(SCRIPT)],cwd=self.repo,env={**self.env,'BUILD_OK':str(build_ok)},
                              text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)

    def value(self, branch):
        return self.git(self.remote,'show',branch+':data.json')

    def test_success_persists_without_recovery_branch(self):
        result=self.persist(1)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(self.value('master'),'new observation')
        self.assertEqual(self.git(self.remote,'for-each-ref','--format=%(refname)','refs/heads/collection-recovery'),'')

    def test_build_failure_preserves_observations_without_deploying_master(self):
        result=self.persist(0)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.value('master'),'old observation')
        self.assertEqual(self.value('collection-recovery/123-1'),'new observation')

    def test_rebase_conflict_preserves_both_remote_and_runner_data(self):
        other=Path(self.temp.name)/'other'
        self.git(Path(self.temp.name),'clone',str(self.remote),str(other)); self.identity(other)
        (other/'data.json').write_text('concurrent observation')
        self.git(other,'add','data.json'); self.git(other,'commit','-m','concurrent fixture'); self.git(other,'push')
        result=self.persist(1)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.value('master'),'concurrent observation')
        self.assertEqual(self.value('collection-recovery/123-1'),'new observation')

    def test_primary_push_rejection_preserves_recovery(self):
        hook=self.remote/'hooks/pre-receive'
        hook.write_text('#!/bin/sh\nwhile read old new ref; do\n  [ "$ref" != refs/heads/master ] || exit 1\ndone\n')
        hook.chmod(0o755)
        result=self.persist(1)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.value('master'),'old observation')
        self.assertEqual(self.value('collection-recovery/123-1'),'new observation')

    def test_uncleaned_credentials_fail_closed(self):
        keys=self.repo/'pipeline/_news'; keys.mkdir(parents=True)
        (keys/'naver_key.json').write_text('fixture only')
        result=self.persist(0)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.value('master'),'old observation')
        self.assertEqual(self.git(self.remote,'for-each-ref','--format=%(refname)','refs/heads/collection-recovery'),'')


if __name__ == '__main__':
    unittest.main()

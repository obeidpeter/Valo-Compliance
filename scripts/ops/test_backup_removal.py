import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from backup_retention import plan
from backup_removal import remove
from recovery_archive import ArchiveError

GROUP = 'valo-development-recovery-v1'


def listed(snapshot_id, taken, tag=GROUP):
    return {'id': snapshot_id * 64, 'time': taken.isoformat().replace('+00:00', 'Z'), 'tags': [tag] if tag else []}


class BackupRemovalTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name).resolve()
        self.plans = root / 'plans'; self.plans.mkdir(mode=0o700)
        self.source = root / 'source'; self.source.mkdir(mode=0o700)
        password = root / 'password'; password.write_text('synthetic-private-test-' * 3); password.chmod(0o600)
        self.env = {**os.environ, 'NODE_ENV': 'test', 'TZ': 'UTC', 'VALO_RECOVERY_ARCHIVE_MODE': 'synthetic-local-only',
                    'RESTIC_REPOSITORY': str(root / 'repository'), 'RESTIC_PASSWORD_FILE': str(password)}
        self.now = datetime.datetime(2026, 11, 20, 12, 0, tzinfo=datetime.timezone.utc)

    def tearDown(self): self.temp.cleanup()

    def reviewed(self, listing, planned_at):
        path = self.plans / 'plan.json'
        path.write_text(json.dumps(plan(listing, planned_at), indent=2)); path.chmod(0o600)
        return path, hashlib.sha256(path.read_bytes()).hexdigest()

    def listing(self):
        day = datetime.timedelta(days=1)
        return [listed('a', self.now - datetime.timedelta(hours=1)), listed('b', self.now - 5 * day),
                listed('c', self.now - 5 * day - datetime.timedelta(hours=2)), listed('d', self.now - 40 * day),
                listed('e', self.now - 50 * day, tag=None)]

    def test_nothing_is_read_or_removed_without_the_reviewed_plan_and_its_hash(self):
        path, digest = self.reviewed(self.listing(), self.now)
        cases = [('0' * 64, self.now, 'PLAN_CONFIRMATION_MISMATCH'), ('not-a-hash', self.now, 'PLAN_CONFIRMATION_REQUIRED'),
                 (digest, self.now + datetime.timedelta(hours=25), 'PLAN_TOO_OLD'),
                 (digest, self.now - datetime.timedelta(hours=1), 'PLAN_IN_FUTURE')]
        for confirmed, now, code in cases:
            with patch('backup_removal.restic') as backend:
                with self.assertRaisesRegex(ArchiveError, code): remove(path, confirmed, self.env, now)
                backend.assert_not_called()
        # A plan under another policy is refused, even with its own hash.
        changed = json.loads(path.read_text()); changed['policy']['keepDailyDays'] = 7
        path.write_text(json.dumps(changed)); path.chmod(0o600)
        with patch('backup_removal.restic') as backend:
            with self.assertRaisesRegex(ArchiveError, 'PLAN_INVALID'):
                remove(path, hashlib.sha256(path.read_bytes()).hexdigest(), self.env, self.now)
            backend.assert_not_called()

    def test_nothing_is_removed_when_the_repository_no_longer_matches_the_review(self):
        path, digest = self.reviewed(self.listing(), self.now)
        later = self.now + datetime.timedelta(hours=2)
        # A snapshot the review removes is already gone; then backups stop, so the group keeps everything.
        gone = [s for s in self.listing() if s['id'] != 'd' * 64]
        hours = datetime.timedelta(hours=47)
        stale_path, stale_digest = self.reviewed([listed('a', self.now - hours), *self.listing()[1:]], self.now)
        for listing, plan_path, confirmed, code in [(gone, path, digest, 'PLAN_NO_LONGER_CURRENT'),
                                                    ([listed('a', self.now - hours), *self.listing()[1:]], stale_path,
                                                     stale_digest, 'BACKUPS_STALE')]:
            with patch('backup_removal.restic', return_value=json.dumps(listing).encode()) as backend:
                with self.assertRaisesRegex(ArchiveError, code): remove(plan_path, confirmed, self.env, later)
                self.assertEqual([c.args[0][0] for c in backend.call_args_list], ['snapshots'], 'only read')

    def test_real_repository_loses_only_the_reviewed_snapshots_and_their_data(self):
        if not shutil.which('restic'):
            if os.environ.get('VALO_REQUIRE_REAL_RESTIC') == '1': self.fail('restic is required')
            self.skipTest('installed restic required')
        run = lambda *args: subprocess.run(['restic', '--no-cache', *args], env=self.env, capture_output=True,
                                           timeout=120, check=True).stdout
        run('init')
        now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
        day = datetime.timedelta(days=1)
        older_same_day = (now - 5 * day).replace(hour=8, minute=0, second=0)
        for index, (taken, tag) in enumerate([(now - datetime.timedelta(hours=1), GROUP),
                                               (older_same_day + datetime.timedelta(hours=2), GROUP),
                                               (older_same_day, GROUP), (now - 40 * day, GROUP),
                                               (now - 50 * day, None)]):
            (self.source / 'synthetic.txt').write_text(f'synthetic backup content {index}\n')
            run('backup', '--host', 'synthetic-host', '--time', taken.strftime('%Y-%m-%d %H:%M:%S'),
                *(['--tag', tag] if tag else []), str(self.source / 'synthetic.txt'))
        before = {s['time'][:19]: s['id'] for s in json.loads(run('snapshots', '--json'))}
        path, digest = self.reviewed(json.loads(run('snapshots', '--json')), now)
        receipt = remove(path, digest, self.env, now)
        removed = {before[older_same_day.strftime('%Y-%m-%dT%H:%M:%S')], before[(now - 40 * day).strftime('%Y-%m-%dT%H:%M:%S')]}
        self.assertEqual(set(receipt['removed']), removed)
        self.assertEqual(receipt['snapshotsRemoved'], 2)
        self.assertTrue(receipt['pruned'])
        remaining = {s['id'] for s in json.loads(run('snapshots', '--json'))}
        self.assertEqual(remaining, set(before.values()) - removed, 'the untagged snapshot and the kept ones remain')
        run('check')
        # Run again with a fresh plan: nothing more is due, so nothing is removed.
        path, digest = self.reviewed(json.loads(run('snapshots', '--json')), now)
        self.assertEqual(remove(path, digest, self.env, now)['snapshotsRemoved'], 0)


if __name__ == '__main__': unittest.main()

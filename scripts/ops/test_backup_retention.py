import datetime
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from backup_retention import plan, snapshot_time

NOW = datetime.datetime(2026, 11, 16, 12, 0, tzinfo=datetime.timezone.utc)
DATABASE = 'valo-development-recovery-v1'
JOURNAL = 'valo-development-privacy-journal-v1'


def snapshot(number, hours_ago, tags):
    taken = NOW - datetime.timedelta(hours=hours_ago)
    return {'id': f'{number:064x}', 'time': taken.strftime('%Y-%m-%dT%H:%M:%S.123456789Z'),
            'tags': [*tags, f'synthetic-run-{number}'], 'hostname': 'valo-recovery'}


class BackupRetentionTest(unittest.TestCase):
    def test_hourly_backups_keep_two_days_then_one_per_day_for_35_days(self):
        snapshots = [snapshot(n, n, [DATABASE]) for n in range(60 * 24)]
        result = plan(snapshots, NOW)['groups'][DATABASE]
        kept = {s['id']: NOW - snapshot_time(s['time']) for s in snapshots if s['id'] in result['keep']}
        self.assertEqual(result['status'], 'OK')
        self.assertEqual(len(result['keep']) + len(result['remove']), len(snapshots))
        self.assertEqual(sum(age <= datetime.timedelta(hours=48) for age in kept.values()), 49)
        self.assertTrue(all(age <= datetime.timedelta(days=35) for age in kept.values()))
        older_days = {(NOW - age).date() for age in kept.values() if age > datetime.timedelta(hours=48)}
        older_kept = [age for age in kept.values() if age > datetime.timedelta(hours=48)]
        self.assertEqual(len(older_days), len(older_kept), 'at most one snapshot per day after 48 hours')
        # 13 November back to 12 October (the oldest day with a snapshot inside 35 days): 13 + 20 days.
        self.assertEqual(len(older_days), 33)
        self.assertIn(f'{0:064x}', result['keep'])

    def test_the_newest_snapshot_of_each_day_is_the_one_kept(self):
        snapshots = [snapshot(1, 0, [DATABASE]), snapshot(2, 72, [DATABASE]), snapshot(3, 75, [DATABASE])]
        result = plan(snapshots, NOW)['groups'][DATABASE]
        self.assertEqual(result['keep'], [f'{1:064x}', f'{2:064x}'])
        self.assertEqual(result['remove'], [f'{3:064x}'])

    def test_stopped_backups_keep_everything(self):
        snapshots = [snapshot(n, 49 + n * 24, [DATABASE]) for n in range(50)]
        result = plan(snapshots, NOW)['groups'][DATABASE]
        self.assertEqual(result['status'], 'BACKUPS_STALE')
        self.assertEqual(result['remove'], [])
        self.assertEqual(len(result['keep']), 50)

    def test_groups_are_planned_separately_and_unknown_snapshots_are_left_alone(self):
        snapshots = [snapshot(1, 1, [JOURNAL]), snapshot(2, 100, [DATABASE]), snapshot(3, 2000, ['other-tool'])]
        result = plan(snapshots, NOW)
        self.assertEqual(result['groups'][JOURNAL]['status'], 'OK')
        self.assertEqual(result['groups'][DATABASE]['status'], 'BACKUPS_STALE')
        self.assertEqual(result['unknownSnapshots'], [f'{3:064x}'])
        self.assertEqual(result['snapshotsRemoved'], 0)

    def test_untrustworthy_input_stops_the_plan(self):
        cases = {
            'SNAPSHOT_TIME_IN_FUTURE': [snapshot(1, -1, [DATABASE])],
            'SNAPSHOT_ID_DUPLICATE': [snapshot(1, 1, [DATABASE]), snapshot(1, 2, [DATABASE])],
            'SNAPSHOT_ID_INVALID': [{**snapshot(1, 1, [DATABASE]), 'id': 'abc'}],
            'SNAPSHOT_TIME_INVALID': [{**snapshot(1, 1, [DATABASE]), 'time': 'yesterday'}],
            'SNAPSHOT_GROUP_AMBIGUOUS': [snapshot(1, 1, [DATABASE, JOURNAL])],
            'SNAPSHOT_TAGS_INVALID': [{**snapshot(1, 1, [DATABASE]), 'tags': 'valo'}],
        }
        for code, snapshots in cases.items():
            with self.subTest(code), self.assertRaisesRegex(Exception, code):
                plan(snapshots, NOW)
        with self.assertRaisesRegex(Exception, 'RETENTION_POLICY_INVALID'):
            plan([], NOW, {'version': 1, 'keepAllHours': 48, 'keepDailyDays': 1})

    def test_restic_times_with_offsets_and_nanoseconds(self):
        self.assertEqual(snapshot_time('2026-11-16T13:00:00.123456789+01:00'),
                         datetime.datetime(2026, 11, 16, 12, 0, 0, 123456, tzinfo=datetime.timezone.utc))
        self.assertEqual(snapshot_time('2026-11-16T12:00:00Z'), NOW)

    def test_command_prints_a_plan_and_reports_only_codes(self):
        with tempfile.TemporaryDirectory() as directory:
            listing = Path(directory) / 'snapshots.json'
            recent = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
            listing.write_text(json.dumps([{'id': 'a' * 64, 'time': recent.strftime('%Y-%m-%dT%H:%M:%SZ'),
                                            'tags': [DATABASE]}]))
            script = Path(__file__).with_name('backup_retention.py')
            result = subprocess.run([sys.executable, str(script), str(listing)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['groups'][DATABASE]['keep'], ['a' * 64])
            listing.write_text(json.dumps([{'id': 'synthetic private value', 'time': 'x', 'tags': []}]))
            result = subprocess.run([sys.executable, str(script), str(listing)], capture_output=True, text=True, timeout=30)
            self.assertEqual((result.returncode, result.stderr.strip()), (1, 'SNAPSHOT_ID_INVALID'))


if __name__ == '__main__':
    unittest.main()

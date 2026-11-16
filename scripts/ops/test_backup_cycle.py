import datetime
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import backup_cycle as backup
import backup_scheduler as scheduler


@unittest.skipUnless(os.name == 'posix', 'POSIX host lock and permissions')
class BackupCycleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.config = self.root / 'config.json'
        self.values = {'version': 1, 'sourceRoot': str(self.root), 'stateDirectory': str(self.root),
                       'sourceIdentitySha256': 'a' * 64, 'releaseSha': 'b' * 40,
                       'credentialExpiresAt': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)).isoformat()}
        self.config.write_text(json.dumps(self.values)); self.config.chmod(0o600)
        self.env = {'NODE_ENV': 'development', 'VALO_RESTIC_PASSWORD': 'synthetic-password-' * 4,
                    'VALO_BACKUP_MONITOR_URL': 'https://hc-ping.com/00000000-0000-4000-8000-000000000001'}
        self.cutoff = datetime.datetime.now(datetime.timezone.utc).isoformat()

    def tearDown(self):
        self.temp.cleanup()

    def capture(self, mode, directory, config, env):
        directory.mkdir(); (directory / 'bundle').mkdir()
        return {'sourceWrites': 0, 'sourceIdentitySha256': 'a' * 64, 'cutoff': self.cutoff, 'retentionEntries': 0}

    def test_success_requires_both_readbacks_and_removes_plaintext_before_green(self):
        calls = []
        def ping(url, suffix):
            calls.append(suffix)
            if suffix == '':
                self.assertFalse(list(self.root.glob('capture-*')))
            return True
        with patch.object(backup, 'capture', self.capture), patch.object(backup, 'ping', ping), \
             patch.object(backup, 'backup_and_verify', return_value={'snapshotId': 'c' * 64}), \
             patch.object(backup, 'archive_journal', return_value={'snapshotId': 'd' * 64, 'retentionInventoryPresent': True}):
            self.assertEqual(backup.cycle(self.config, self.env)['status'], 'verified')
        self.assertEqual(calls, ['/start', ''])

    def test_archive_or_journal_failure_cannot_emit_success_and_lock_releases(self):
        for boundary in ('backup_and_verify', 'archive_journal'):
            with self.subTest(boundary=boundary), patch.object(backup, 'capture', self.capture), \
                 patch.object(backup, 'ping', return_value=True) as ping, \
                 patch.object(backup, 'backup_and_verify', return_value={'snapshotId': 'c' * 64}) as archive, \
                 patch.object(backup, 'archive_journal', return_value={'snapshotId': 'd' * 64, 'retentionInventoryPresent': True}) as journal:
                (archive if boundary == 'backup_and_verify' else journal).side_effect = RuntimeError('SYNTHETIC_FAILURE')
                with self.assertRaises(RuntimeError): backup.cycle(self.config, self.env)
                self.assertEqual([c.args[1] for c in ping.call_args_list], ['/start', '/fail'])
                self.assertFalse(list(self.root.glob('capture-*')))

    def test_duplicate_cycle_does_not_ping_or_capture(self):
        import fcntl
        with (self.root / 'cycle.lock').open('a') as lock, patch.object(backup, 'ping') as ping:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, 'BACKUP_ALREADY_RUNNING'): backup.cycle(self.config, self.env)
            ping.assert_not_called()

    def test_missing_retention_capture_or_readback_cannot_emit_success(self):
        for boundary in ('capture', 'archive'):
            def capture(mode, directory, config, env):
                result = self.capture(mode, directory, config, env)
                if boundary == 'capture' and mode == 'journal': result.pop('retentionEntries')
                return result
            journal = {'snapshotId': 'd' * 64, 'retentionInventoryPresent': boundary != 'archive'}
            with self.subTest(boundary=boundary), patch.object(backup, 'capture', capture), \
                 patch.object(backup, 'ping', return_value=True) as ping, \
                 patch.object(backup, 'backup_and_verify', return_value={'snapshotId': 'c' * 64}), \
                 patch.object(backup, 'archive_journal', return_value=journal):
                with self.assertRaisesRegex(Exception, 'RETENTION_JOURNAL_'):
                    backup.cycle(self.config, self.env)
                self.assertEqual([c.args[1] for c in ping.call_args_list], ['/start', '/fail'])

    def test_preflight_rejects_deployment_expiry_public_config_and_wrong_monitor(self):
        for env in ({**self.env, 'NODE_ENV': 'production'}, {**self.env, 'REPLIT_DEPLOYMENT_ID': 'false'}):
            with self.assertRaises(Exception): backup.configuration(self.config, env)
        self.values['credentialExpiresAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        self.config.write_text(json.dumps(self.values))
        with self.assertRaisesRegex(Exception, 'ROTATION_REQUIRED'): backup.configuration(self.config, self.env)
        self.config.chmod(0o644)
        with self.assertRaisesRegex(Exception, 'PRIVATE_FILE'): backup.configuration(self.config, self.env)
        for value in ('https://example.invalid/secret', self.env['VALO_BACKUP_MONITOR_URL'] + '?q=secret'):
            with self.assertRaises(Exception): backup.monitor_url({**self.env, 'VALO_BACKUP_MONITOR_URL': value})
        with self.assertRaises(Exception): backup.monitor_url({**self.env, 'VALO_WORKER_MONITOR_URL': self.env['VALO_BACKUP_MONITOR_URL']})

    def test_scheduler_preflight_failure_alerts_without_success(self):
        import threading
        stop = threading.Event()
        def failure(*args): stop.set(); raise RuntimeError('SYNTHETIC_EXPIRED_KEY')
        with patch.object(scheduler, 'ping', return_value=True) as ping:
            scheduler.schedule(self.config, self.env, stop, failure, interval=1)
        self.assertEqual([c.args[1] for c in ping.call_args_list], ['/fail'])
        self.assertEqual(json.loads((self.root / 'scheduler-status.json').read_text())['status'], 'failed')


if __name__ == '__main__': unittest.main()

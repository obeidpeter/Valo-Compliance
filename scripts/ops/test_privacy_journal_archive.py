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

from privacy_journal_archive import archive_journal


class JournalArchiveTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'journal'; self.source.mkdir(mode=0o700)
        self.path = self.source / 'privacy-journal.json'
        self.now = datetime.datetime.now(datetime.timezone.utc)
        self.payload = {'version': 1, 'kind': 'current-development-privacy-journal', 'sourceIdentitySha256': 'a' * 64,
                        'cutoff': self.now.isoformat(), 'controls': {'valo_memberships': []}}
        self.save()
        self.password = self.root / 'password'; self.password.write_text('synthetic-private-test-' * 3); self.password.chmod(0o600)
        self.env = {**os.environ, 'NODE_ENV': 'test', 'VALO_RECOVERY_ARCHIVE_MODE': 'synthetic-local-only',
                    'RESTIC_REPOSITORY': str(self.root / 'repository'), 'RESTIC_PASSWORD_FILE': str(self.password)}

    def save(self):
        self.path.write_text(json.dumps({'version': 1, 'payload': json.dumps(self.payload),
                                        'authentication': {'algorithm': 'HMAC-SHA256', 'mac': 'b' * 64}}))
        self.path.chmod(0o600)

    def tearDown(self): self.temp.cleanup()

    def test_wrong_source_stale_future_and_presnapshot_journal_cannot_reach_backend(self):
        baseline = self.now - datetime.timedelta(seconds=20)
        for cutoff, source, snapshot in [(self.now, 'c' * 64, baseline),
                                         (self.now - datetime.timedelta(minutes=10), 'a' * 64, baseline),
                                         (self.now + datetime.timedelta(minutes=10), 'a' * 64, baseline),
                                         (baseline, 'a' * 64, self.now)]:
            self.payload.update(cutoff=cutoff.isoformat(), sourceIdentitySha256=source); self.save()
            with patch('privacy_journal_archive.restic') as backend:
                with self.assertRaises(Exception): archive_journal(self.path, self.root / 'receipt.json', self.env, 'a' * 64, snapshot.isoformat())
                backend.assert_not_called()

    def test_real_encrypted_independent_journal_readback(self):
        if not shutil.which('restic'):
            if os.environ.get('VALO_REQUIRE_REAL_RESTIC') == '1': self.fail('restic is required')
            self.skipTest('installed restic required')
        initialized = subprocess.run(['restic', '--no-cache', 'init'], env=self.env, capture_output=True, timeout=30)
        self.assertEqual(initialized.returncode, 0, 'synthetic repository init failed')
        receipt = archive_journal(self.path, self.root / 'receipt.json', self.env, 'a' * 64,
                                  (self.now - datetime.timedelta(seconds=20)).isoformat())
        self.assertEqual(receipt['sha256'], hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertTrue(receipt['independentOfDatabaseSnapshot'])
        self.assertFalse(receipt['signatureAuthenticatedOnRecoveryHost'])
        self.assertFalse(receipt['erasureReplayValidated'])


if __name__ == '__main__': unittest.main()

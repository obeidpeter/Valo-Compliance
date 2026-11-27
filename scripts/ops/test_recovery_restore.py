import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from operator_journal import JOURNAL_NAME, verify
from recovery_archive import create_tar, inspect_bundle
from recovery_restore import unpack_verified_archive

WHO = {'operator': 'synthetic-operator', 'reason': 'Synthetic restore drill of a pinned archive.'}


class RestoreTest(unittest.TestCase):
    def test_pinned_restore_and_malicious_member_rejection(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name).resolve()
            bundle = root / 'bundle'
            bundle.mkdir(mode=0o700)
            manifest = {'version': 1, 'scope': 'synthetic', 'releaseSha': 'a' * 40, 'files': []}
            for filename in ('database.dump', 'recovery-controls.json', 'object-index.json'):
                value = b'synthetic fixture'
                path = bundle / filename
                path.write_bytes(value)
                path.chmod(0o600)
                manifest['files'].append({'path': filename, 'sha256': hashlib.sha256(value).hexdigest(), 'bytes': len(value)})
            (bundle / 'manifest.json').write_text(json.dumps(manifest))
            (bundle / 'manifest.json').chmod(0o600)
            archive = root / 'good.tar'
            create_tar(bundle, inspect_bundle(bundle)[1], archive)
            checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
            journal = root / 'journal'
            journal.mkdir(mode=0o700)
            env = {'VALO_OPERATOR_JOURNAL': str(journal)}
            # Nothing is unpacked without who asks, why, and a private journal to write them to (ADM-009).
            for where, kwargs, code in (({}, WHO, 'OPERATOR_JOURNAL_REQUIRED'),
                                        (env, {'operator': WHO['operator']}, 'OPERATOR_REASON_REQUIRED'),
                                        (env, {'reason': WHO['reason']}, 'OPERATOR_REQUIRED'),
                                        ({'VALO_OPERATOR_JOURNAL': str(root)}, WHO, 'OPERATOR_JOURNAL_SEPARATE_REQUIRED')):
                with self.assertRaisesRegex(Exception, code):
                    unpack_verified_archive(archive, root / 'refused', checksum, where, **kwargs)
                self.assertFalse((root / 'refused').exists())
            self.assertFalse((journal / JOURNAL_NAME).exists())
            result = unpack_verified_archive(archive, root / 'restored', checksum, env, **WHO)
            self.assertEqual(result['fileCount'], 3)
            self.assertFalse(result['applicationAccessEnabled'])
            entries = [json.loads(line) for line in (journal / JOURNAL_NAME).read_text().splitlines()]
            self.assertEqual([e['outcome'] for e in entries], ['started', 'completed'])
            self.assertEqual({(e['operator'], e['reason'], e['target']) for e in entries},
                             {(*WHO.values(), 'recovery_archive:' + checksum)})
            self.assertEqual(entries[0]['details'], {'destination': str(root / 'restored'), 'scope': 'synthetic',
                                                     'releaseSha': 'a' * 40})
            self.assertEqual((result['startedSha256'], result['journalSha256']),
                             (entries[0]['sha256'], entries[1]['sha256']))
            self.assertEqual(entries[1]['details'], {k: v for k, v in result.items() if k != 'journalSha256'})
            with self.assertRaisesRegex(Exception, 'ARCHIVE_HASH_MISMATCH'):
                unpack_verified_archive(archive, root / 'bad-hash', '0' * 64, env, **WHO)
            self.assertFalse((root / 'bad-hash').exists())
            for kind in ('traversal', 'symlink', 'duplicate'):
                bad = root / (kind + '.tar')
                with tarfile.open(bad, 'w') as output, tarfile.open(archive) as source:
                    for member in source.getmembers():
                        output.addfile(member, source.extractfile(member))
                    entry = tarfile.TarInfo('../outside' if kind == 'traversal' else 'manifest.json')
                    if kind == 'symlink':
                        entry.type = tarfile.SYMTYPE
                        entry.linkname = '../outside'
                    else:
                        entry.size = 1
                    output.addfile(entry, None if kind == 'symlink' else io.BytesIO(b'x'))
                bad.chmod(0o600)
                with self.assertRaises(Exception):
                    unpack_verified_archive(bad, root / kind, hashlib.sha256(bad.read_bytes()).hexdigest(), env, **WHO)
                self.assertFalse((root / kind).exists())
            self.assertFalse((root / 'outside').exists())
            # A refused archive is refused before anything is unpacked, so the journal holds only the restore.
            self.assertEqual(verify(journal)['entries'], 2)


if __name__ == '__main__':
    unittest.main()

import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from recovery_archive import create_tar, inspect_bundle
from recovery_restore import unpack_verified_archive


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
            result = unpack_verified_archive(archive, root / 'restored', checksum)
            self.assertEqual(result['fileCount'], 3)
            self.assertFalse(result['applicationAccessEnabled'])
            with self.assertRaisesRegex(Exception, 'ARCHIVE_HASH_MISMATCH'):
                unpack_verified_archive(archive, root / 'bad-hash', '0' * 64)
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
                    unpack_verified_archive(bad, root / kind, hashlib.sha256(bad.read_bytes()).hexdigest())
                self.assertFalse((root / kind).exists())
            self.assertFalse((root / 'outside').exists())


if __name__ == '__main__':
    unittest.main()

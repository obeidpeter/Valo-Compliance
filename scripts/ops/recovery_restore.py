"""Verify and unpack one pinned archive into a NEW private directory.

No database connection or application startup. Windows callers must supply an
owner-only parent directory; the native operator verifies its ACL independently.

The operator gives their name and their reason (ADM-009). Once the archive is verified, and before the
directory is made, the command writes them, the archive's hash and the directory to the operator's
journal (operator_journal.py); it writes what came of it afterwards.
"""
import json
import os
from pathlib import Path
import re
import tarfile
from operator_journal import append, error_code, journal_directory, operator_record
from recovery_archive import require, digest, private_regular, inspect_bundle, verify_tar


def unpack_verified_archive(archive_path, destination, expected_sha256, env=None, operator=None, reason=None):
    who = operator_record(operator, reason)
    journal = journal_directory(os.environ if env is None else env)
    require(re.fullmatch(r'[a-f0-9]{64}', expected_sha256), 'PINNED_ARCHIVE_HASH_REQUIRED')
    private_regular(archive_path)
    require(archive_path.stat().st_size <= 250_000_000, 'BOUNDED_ARCHIVE_REQUIRED')
    require(digest(archive_path) == expected_sha256, 'ARCHIVE_HASH_MISMATCH')
    require(destination.is_absolute() and destination == destination.resolve() and
            not destination.exists() and destination.parent.is_dir(), 'NEW_RESTORE_DIRECTORY_REQUIRED')
    if os.name == 'posix':
        info = destination.parent.stat()
        require(info.st_uid == os.getuid() and not info.st_mode & 0o077, 'PRIVATE_RESTORE_PARENT_REQUIRED')
    with tarfile.open(archive_path, 'r') as archive:
        entries = archive.getmembers()
        require(len(entries) <= 10004 and all(e.isfile() and e.size <= 100_000_000 for e in entries), 'ARCHIVE_MEMBERS_INVALID')
        require(len({e.name for e in entries}) == len(entries), 'DUPLICATE_ARCHIVE_MEMBER')
        manifests = [e for e in entries if e.name == 'manifest.json']
        require(len(manifests) == 1 and manifests[0].size <= 4_000_000, 'ARCHIVE_MANIFEST_REQUIRED')
        manifest = json.load(archive.extractfile(manifests[0]))
        require(isinstance(manifest, dict) and set(manifest) == {'version', 'scope', 'releaseSha', 'files'} and
                manifest['version'] == 1 and manifest['scope'] in ('synthetic', 'development', 'production') and
                isinstance(manifest['releaseSha'], str) and re.fullmatch(r'[a-f0-9]{40}', manifest['releaseSha']) and
                isinstance(manifest['files'], list), 'MANIFEST_INVALID')
        files = {}
        for item in manifest['files']:
            require(isinstance(item, dict) and set(item) == {'path', 'sha256', 'bytes'}, 'MANIFEST_ENTRY_INVALID')
            name = item['path']
            require(isinstance(name, str) and (name in ('database.dump', 'recovery-controls.json', 'object-index.json') or
                    re.fullmatch(r'objects/[a-f0-9]{64}\.bin', name)), 'BUNDLE_PATH_INVALID')
            require(name not in files and isinstance(item['sha256'], str) and re.fullmatch(r'[a-f0-9]{64}', item['sha256']) and
                    type(item['bytes']) is int and 0 <= item['bytes'] <= 100_000_000, 'MANIFEST_ENTRY_INVALID')
            files[name] = item
        require({'database.dump', 'recovery-controls.json', 'object-index.json'}.issubset(files) and
                files['database.dump']['bytes'] > 0 and files['recovery-controls.json']['bytes'] > 0, 'RECOVERY_COMPONENTS_REQUIRED')
        require(sum(e.size for e in entries) <= 200_000_000, 'BOUNDED_ARCHIVE_REQUIRED')
        # Validate every member before creating a destination or writing any bytes.
        verify_tar(archive_path, manifest, files)
        require(not destination.is_relative_to(journal), 'OPERATOR_JOURNAL_SEPARATE_REQUIRED')
        target_name = f'recovery_archive:{expected_sha256}'
        # Nothing is unpacked until the journal holds who asked, why, and into which directory.
        started = append(journal, who, 'recovery_restore', target_name, 'started',
                         {'destination': str(destination), 'scope': manifest['scope'],
                          'releaseSha': manifest['releaseSha']})
        try:
            destination.mkdir(mode=0o700)
            for entry in entries:
                target = destination / entry.name
                require(target.resolve().is_relative_to(destination), 'RESTORE_CONTAINMENT_FAILED')
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, 'wb') as output, archive.extractfile(entry) as source:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
            verified, members = inspect_bundle(destination)
        except Exception as error:
            append(journal, who, 'recovery_restore', target_name, 'failed',
                   {'error': error_code(error), 'startedSha256': started['sha256']})
            raise
    result = {'status': 'verified', 'scope': verified['scope'], 'releaseSha': verified['releaseSha'],
              'fileCount': len(members), 'databaseRestoreValidated': False, 'applicationAccessEnabled': False,
              'operator': who['operator'], 'reason': who['reason'], 'startedSha256': started['sha256']}
    finished = append(journal, who, 'recovery_restore', target_name, 'completed', result)
    return {**result, 'journalSha256': finished['sha256']}


if __name__ == '__main__':
    import sys
    try:
        # recovery_restore.py <archive> <new directory> <sha256> --operator <name> --reason <why>
        args = sys.argv[1:]
        require(len(args) == 7 and args[3] == '--operator' and args[5] == '--reason', 'RESTORE_ARGUMENTS_INVALID')
        print(json.dumps(unpack_verified_archive(Path(args[0]), Path(args[1]), args[2], operator=args[4],
                                                 reason=args[6])))
    except Exception:
        print('ARCHIVE_RESTORE_FAILED', file=sys.stderr)
        sys.exit(1)

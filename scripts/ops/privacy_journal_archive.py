"""Retain current authenticated controls separately from database snapshots.

Transport verifies exact bytes. Signature authentication and replay require the
independently held application key on the recovery host.
"""
import datetime
import json
import os
from pathlib import Path
import re
import tempfile
import uuid
from recovery_archive import require, private_regular, digest, configuration, restic


def archive_journal(path, receipt_path, env, expected_source, snapshot_cutoff):
    private_regular(path)
    require(path.stat().st_size <= 20_000_000, 'BOUNDED_JOURNAL_REQUIRED')
    envelope = json.loads(path.read_text('utf-8'))
    require(envelope.get('version') == 1 and isinstance(envelope.get('payload'), str), 'JOURNAL_INVALID')
    payload = json.loads(envelope['payload'])
    require(payload.get('version') == 1 and payload.get('kind') == 'current-development-privacy-journal' and
            payload.get('sourceIdentitySha256') == expected_source, 'JOURNAL_SOURCE_MISMATCH')
    require(re.fullmatch(r'[a-f0-9]{64}', expected_source), 'SOURCE_BINDING_REQUIRED')
    cutoff = datetime.datetime.fromisoformat(payload['cutoff'].replace('Z', '+00:00'))
    snapshot = datetime.datetime.fromisoformat(snapshot_cutoff.replace('Z', '+00:00'))
    age = (datetime.datetime.now(datetime.timezone.utc) - cutoff).total_seconds()
    require(cutoff >= snapshot and 0 <= age <= 180, 'FRESH_POST_SNAPSHOT_JOURNAL_REQUIRED')
    auth = envelope.get('authentication', {})
    require(auth.get('algorithm') == 'HMAC-SHA256' and re.fullmatch(r'[a-f0-9]{64}', auth.get('mac', '')),
            'SIGNED_JOURNAL_REQUIRED')
    require(not receipt_path.exists() and receipt_path.is_absolute() and receipt_path == receipt_path.resolve() and
            not receipt_path.is_relative_to(path.parent), 'NEW_JOURNAL_RECEIPT_REQUIRED')
    mode, backend, child_env = configuration(env, path.parent)
    require(mode == 'synthetic-local-only' or child_env['RESTIC_REPOSITORY'].endswith('/valo-development'), 'JOURNAL_SCOPE_MISMATCH')
    run_id = str(uuid.uuid4())
    checksum = digest(path)
    with path.open('rb') as stream:
        output = restic(['backup', '--stdin', '--stdin-filename', 'privacy-journal.json', '--host', 'valo-recovery',
                         '--tag', 'valo-development-privacy-journal-v1', '--tag', run_id, '--json'], child_env, stream)
    summaries = [json.loads(line) for line in output.splitlines() if line.strip()]
    ids = [r.get('snapshot_id') for r in summaries if r.get('message_type') == 'summary']
    require(len(ids) == 1 and isinstance(ids[0], str) and re.fullmatch(r'[a-f0-9]{64}', ids[0]), 'JOURNAL_SNAPSHOT_UNCONFIRMED')
    with tempfile.TemporaryDirectory(prefix='valo-journal-verify-') as temporary:
        target = Path(temporary)
        restic(['restore', ids[0], '--target', str(target), '--verify'], child_env)
        restored = target / 'privacy-journal.json'
        require(restored.is_file() and not restored.is_symlink() and digest(restored) == checksum, 'JOURNAL_READBACK_FAILED')
    receipt = {'version': 1, 'kind': 'independent-current-privacy-journal', 'status': 'verified', 'backend': backend,
               'scope': 'development', 'snapshotId': ids[0], 'sha256': checksum, 'sourceIdentitySha256': expected_source,
               'cutoff': payload['cutoff'], 'independentOfDatabaseSnapshot': True,
               'offHostTransportVerified': mode == 'approved-b2', 'signatureAuthenticatedOnRecoveryHost': False,
               'erasureReplayValidated': False,
               'retentionInventoryPresent': isinstance(payload.get('exportRetention'), dict) and
                   payload['exportRetention'].get('version') == 1 and payload['exportRetention'].get('complete') is True and
                   isinstance(payload['exportRetention'].get('entries'), list),
               'retentionReplayValidated': False}
    with os.fdopen(os.open(receipt_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as file:
        json.dump(receipt, file)
    return receipt

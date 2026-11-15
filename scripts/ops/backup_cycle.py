"""One bounded, non-overlapping development backup cycle for an external timer.

Never initializes/prunes a repository, installs a timer, or activates production.
Success requires a fresh snapshot read-back AND a newer independent journal read-back.
"""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request
import uuid
from recovery_archive import require, private_regular, backup_and_verify
from privacy_journal_archive import archive_journal


def configuration(path, env):
    private_regular(path)
    config = json.loads(path.read_text('utf-8'))
    require(set(config) == {'version', 'sourceRoot', 'stateDirectory', 'sourceIdentitySha256', 'releaseSha', 'credentialExpiresAt'}, 'BACKUP_CONFIG_INVALID')
    require(config['version'] == 1 and re.fullmatch(r'[a-f0-9]{64}', config['sourceIdentitySha256']) and
            re.fullmatch(r'[a-f0-9]{40}', config['releaseSha']), 'BACKUP_BINDING_INVALID')
    require(os.name == 'posix' and env.get('NODE_ENV') == 'development' and
            not any(v for k, v in env.items() if k.startswith('REPLIT_DEPLOYMENT')), 'DEVELOPMENT_BACKUP_ONLY')
    for name in ('sourceRoot', 'stateDirectory'):
        p = Path(config[name])
        require(p.is_absolute() and p == p.resolve() and p.is_dir(), 'CANONICAL_BACKUP_DIRECTORY_REQUIRED')
    state = Path(config['stateDirectory'])
    info = state.stat()
    require(info.st_uid == os.getuid() and not info.st_mode & 0o077, 'PRIVATE_BACKUP_STATE_REQUIRED')
    expiry = datetime.datetime.fromisoformat(config['credentialExpiresAt'].replace('Z', '+00:00'))
    require(expiry > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2), 'BACKUP_CREDENTIAL_ROTATION_REQUIRED')
    return config


def monitor_url(env):
    value = env.get('VALO_BACKUP_MONITOR_URL', '')
    require(re.fullmatch(r'https://hc-ping\.com/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', value), 'BACKUP_MONITOR_REQUIRED')
    require(value not in (env.get('VALO_WORKER_MONITOR_URL'), env.get('VALO_OPERATIONS_MONITOR_URL')), 'SEPARATE_BACKUP_MONITOR_REQUIRED')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def ping(url, suffix):
    try:
        request = urllib.request.Request(url + suffix, method='POST')
        with urllib.request.build_opener(NoRedirect).open(request, timeout=5) as response:
            return response.status == 200
    except Exception:
        return False


def capture(mode, directory, config, env):
    # Only database/storage identity and signing context enter capture; no B2 or monitor credentials.
    child = {k: v for k, v in env.items() if k in ('PATH', 'LANG', 'LC_ALL', 'TMP', 'TEMP', 'LD_LIBRARY_PATH',
             'DATABASE_URL', 'SESSION_SECRET', 'VALO_PRIVACY_KEYRING', 'PRIVATE_OBJECT_DIR')}
    # The installed native SDK obtains its credentials from the loopback sidecar.
    child.update(NODE_ENV='development', VALO_RECOVERY_SOURCE_ROOT=config['sourceRoot'])
    command = ['node', str(Path(__file__).with_name('recovery_capture.mjs')), mode, str(directory),
               config['sourceIdentitySha256'], config['releaseSha']]
    result = subprocess.run(command, cwd=config['sourceRoot'], env=child, capture_output=True, timeout=300)
    require(result.returncode == 0 and len(result.stdout) <= 100_000, 'CONSISTENT_CAPTURE_FAILED')
    receipt = json.loads(result.stdout)
    require(receipt.get('sourceWrites') == 0 and receipt.get('sourceIdentitySha256') == config['sourceIdentitySha256'], 'CAPTURE_RECEIPT_INVALID')
    return receipt


def cycle(config_path, env):
    import fcntl
    os.umask(0o077)
    config = configuration(config_path, env)
    url = monitor_url(env)
    state = Path(config['stateDirectory'])
    lock_path = state / 'cycle.lock'
    require(not lock_path.is_symlink(), 'BACKUP_LOCK_LINK_FORBIDDEN')
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('BACKUP_ALREADY_RUNNING') from None
        run_id = str(uuid.uuid4())
        report = {'version': 1, 'runId': run_id, 'status': 'running', 'scope': 'development',
                  'sourceWrites': 0, 'pruningEnabled': False, 'productionActivated': False}
        receipt_path = state / (run_id + '.json')
        ping(url, '/start')
        try:
            with tempfile.TemporaryDirectory(prefix='capture-', dir=state) as temporary:
                scratch = Path(temporary)
                snapshot = capture('snapshot', scratch / 'snapshot', config, env)
                password = scratch / 'password'
                secret = env.get('VALO_RESTIC_PASSWORD', '')
                require(len(secret.encode()) >= 32, 'RECOVERY_PASSWORD_REQUIRED')
                password.write_text(secret)
                password.chmod(0o600)
                archive_env = {**env, 'VALO_RECOVERY_ARCHIVE_MODE': 'approved-b2', 'RESTIC_PASSWORD_FILE': str(password)}
                archived = backup_and_verify(scratch / 'snapshot' / 'bundle', scratch / 'archive.json', archive_env)
                journal = capture('journal', scratch / 'journal', config, env)
                journal_archive = archive_journal(scratch / 'journal' / 'privacy-journal.json', scratch / 'journal-receipt.json',
                                                 archive_env, config['sourceIdentitySha256'], snapshot['cutoff'])
                require(journal_archive['snapshotId'] != archived['snapshotId'], 'INDEPENDENT_JOURNAL_SNAPSHOT_REQUIRED')
                report.update(status='verified', snapshot=snapshot, archive=archived, journal=journal_archive,
                              completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
            # The private plaintext staging and temporary password are gone before success.
            receipt_path.write_text(json.dumps(report))
            report['monitorAcknowledged'] = ping(url, '')
            receipt_path.write_text(json.dumps(report))
            require(report['monitorAcknowledged'], 'BACKUP_MONITOR_DELIVERY_FAILED')
            return report
        except Exception:
            report['status'] = 'failed'
            report['monitorAcknowledged'] = ping(url, '/fail')
            receipt_path.write_text(json.dumps(report))
            raise


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2, 'BACKUP_CONFIG_PATH_REQUIRED')
        report = cycle(Path(sys.argv[1]), dict(os.environ))
        print(json.dumps({'status': report['status'], 'runId': report['runId'], 'monitorAcknowledged': report['monitorAcknowledged']}))
    except Exception:
        print('BACKUP_CYCLE_FAILED', file=sys.stderr)
        sys.exit(1)

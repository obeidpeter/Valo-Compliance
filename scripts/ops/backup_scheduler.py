"""Hourly development backup scheduler; the external check detects host suspension.

This is a workspace scheduler, not an always-on production hosting guarantee.
The same bounded cycle can be used by an approved host's systemd timer instead.
"""
import datetime
import json
import os
from pathlib import Path
import signal
import sys
import threading
import time

from backup_cycle import configuration, cycle, monitor_url, ping
from recovery_archive import require

INTERVAL_SECONDS = 3600


def schedule(config_path, env, stop=None, run_cycle=cycle, interval=INTERVAL_SECONDS):
    import fcntl
    os.umask(0o077)
    config = configuration(config_path, env)
    url = monitor_url(env)
    state = Path(config['stateDirectory'])
    stop = stop or threading.Event()
    lock_path = state / 'scheduler.lock'
    require(not lock_path.is_symlink(), 'SCHEDULER_LOCK_LINK_FORBIDDEN')
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('BACKUP_SCHEDULER_ALREADY_RUNNING') from None
        while not stop.is_set():
            started = time.monotonic()
            status = 'failed'
            try:
                # Revalidate the pinned release, private state and expiring key each cycle.
                configuration(config_path, env)
                receipt = run_cycle(config_path, env)
                require(receipt['status'] == 'verified' and receipt['monitorAcknowledged'], 'BACKUP_CYCLE_UNCONFIRMED')
                status = 'verified'
            except Exception:
                # Preflight failures must alert too, including key expiry or missing env.
                ping(url, '/fail')
            summary = {'version': 1, 'pid': os.getpid(), 'status': status, 'scope': 'development',
                       'intervalSeconds': INTERVAL_SECONDS, 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       'hostSuspensionCoveredByExternalMonitor': True, 'productionSchedule': False}
            target = state / 'scheduler-status.json'
            temporary = state / 'scheduler-status.tmp'
            require(not temporary.is_symlink() and not target.is_symlink(), 'SCHEDULER_STATUS_LINK_FORBIDDEN')
            temporary.write_text(json.dumps(summary))
            temporary.replace(target)
            print(json.dumps({'event': 'backup_scheduler.cycle', 'status': status}), flush=True)
            # One cycle per interval at most. No burst catch-up after sleep or downtime.
            stop.wait(max(1, interval - (time.monotonic() - started)))


if __name__ == '__main__':
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    try:
        require(len(sys.argv) == 2, 'BACKUP_CONFIG_PATH_REQUIRED')
        schedule(Path(sys.argv[1]), dict(os.environ), stopped)
    except Exception:
        print('BACKUP_SCHEDULER_FAILED', file=sys.stderr)
        sys.exit(1)

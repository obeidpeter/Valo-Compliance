"""Outer API/worker process supervision for one POSIX host.

Production verifies the built release and database-bound private rehearsal gate
before spawning services. Customer traffic stays closed.
"""
from collections import deque
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time

from recovery_archive import require, private_regular

STOP_GRACE_SECONDS = 90
RESTART_WINDOW_SECONDS = 600
MAX_RESTARTS = 3


def runtime_configuration(path, env):
    private_regular(path)
    config = json.loads(path.read_text())
    require(set(config) == {'version', 'sourceRoot', 'stateDirectory', 'releaseSha', 'mode'}, 'HOST_CONFIG_INVALID')
    require(config['version'] == 1 and config['mode'] in ('development', 'production') and
            re.fullmatch(r'[a-f0-9]{40}', config['releaseSha']), 'HOST_RELEASE_REQUIRED')
    require(sys.platform == 'linux' and env.get('NODE_ENV') == config['mode'], 'EXPLICIT_LINUX_HOST_MODE_REQUIRED')
    deployed = any(v for k, v in env.items() if k.startswith('REPLIT_DEPLOYMENT'))
    require(config['mode'] != 'development' or not deployed, 'DEPLOYED_DEVELOPMENT_FORBIDDEN')
    for name in ('sourceRoot', 'stateDirectory'):
        path = Path(config[name])
        require(path.is_absolute() and path == path.resolve() and path.is_dir(), 'CANONICAL_HOST_DIRECTORY_REQUIRED')
    state = Path(config['stateDirectory']).stat()
    require(state.st_uid == os.getuid() and not state.st_mode & 0o077, 'PRIVATE_HOST_STATE_REQUIRED')
    if config['mode'] == 'production':
        from release_manifest import verify
        verify(Path(config['sourceRoot']), config['releaseSha'])
        require(env.get('VALO_RELEASE_SHA') == config['releaseSha'], 'PINNED_HOST_RELEASE_REQUIRED')
    else:
        revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=config['sourceRoot'], env=process_environment(env),
                                  capture_output=True, timeout=10)
        require(revision.returncode == 0 and revision.stdout.decode().strip() == config['releaseSha'], 'PINNED_HOST_RELEASE_REQUIRED')
    return config


def process_environment(env):
    # Backup credentials and unsafe process startup hooks do not belong to serving processes.
    forbidden = {'VALO_RESTIC_PASSWORD', 'VALO_BACKUP_MONITOR_URL', 'NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH',
                 'PYTHONSTARTUP', 'LD_PRELOAD', 'BASH_ENV', 'ENV'}
    return {k: v for k, v in env.items() if k not in forbidden and not k.startswith(('AWS_', 'RESTIC_'))}


def production_gate(config, env):
    if config['mode'] != 'production': return
    gate = Path(config['sourceRoot']) / 'artifacts/api-server/dist/production-preflight.mjs'
    require(gate.is_file() and not gate.is_symlink(), 'BUILT_PRODUCTION_GATE_REQUIRED')
    result = subprocess.run(['node', str(gate), '--activate-rehearsal'], cwd=config['sourceRoot'], env=env, capture_output=True, timeout=30)
    # Do not use --configuration-only, set NODE_ENV=development or invent an override.
    require(result.returncode == 0, 'PRODUCTION_ACTIVATION_NOT_APPROVED')


def group_alive(pid):
    try: os.killpg(pid, 0); return True
    except ProcessLookupError: return False


def process_identity(pid):
    try:
        path = Path('/proc') / str(pid)
        tail = (path / 'stat').read_text().rsplit(')', 1)[1].split()
        return {'pid': pid, 'startTicks': tail[19], 'uid': path.stat().st_uid, 'group': int(tail[2])}
    except FileNotFoundError: return None


def recover_previous(state, grace=STOP_GRACE_SECONDS):
    journal = state / 'runtime-children.json'
    if not journal.exists(): return
    private_regular(journal)
    records = json.loads(journal.read_text())
    require(isinstance(records, list) and len(records) <= 2, 'HOST_PROCESS_JOURNAL_INVALID')
    for record in records:
        require(set(record) == {'pid', 'startTicks', 'uid', 'group'} and type(record['pid']) is int and
                record['pid'] > 1 and record['group'] == record['pid'] and record['uid'] == os.getuid(), 'HOST_PROCESS_JOURNAL_INVALID')
        current = process_identity(record['pid'])
        if current and current != record:
            continue  # PID reuse is not permission to signal an unrelated process.
        if current:
            try: os.killpg(record['pid'], signal.SIGTERM)
            except ProcessLookupError: pass
        until = time.monotonic() + grace
        while group_alive(record['pid']) and time.monotonic() < until: time.sleep(0.05)
        require(not group_alive(record['pid']), 'PREVIOUS_HOST_GROUP_STILL_PRESENT')


def record_children(state, records):
    target, temporary = state / 'runtime-children.json', state / 'runtime-children.tmp'
    require(not target.is_symlink() and not temporary.is_symlink(), 'HOST_PROCESS_JOURNAL_LINK_FORBIDDEN')
    temporary.write_text(json.dumps(records))
    temporary.chmod(0o600)
    temporary.replace(target)


def stop_group(child, grace=STOP_GRACE_SECONDS):
    child.poll()  # Reap our direct child before testing its process group.
    if not group_alive(child.pid): return True
    try: os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError: return True
    until = time.monotonic() + grace
    while time.monotonic() < until:
        child.poll()
        if not group_alive(child.pid): return True
        time.sleep(0.05)
    try: os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError: pass
    until = time.monotonic() + 5
    while time.monotonic() < until:
        child.poll()
        if not group_alive(child.pid): return False  # Forced termination is not a clean drain.
        time.sleep(0.05)
    raise RuntimeError('HOST_CHILD_EXIT_UNCONFIRMED')


def supervise(commands, cwd, env, state, stopped, grace=STOP_GRACE_SECONDS, restart_delay=5, poll=0.2):
    children, history, logs, identities = {}, {name: deque() for name in commands}, {}, {}
    clean = True
    def start(name):
        log = state / (name + '-private.log')
        require(not log.is_symlink(), 'HOST_LOG_LINK_FORBIDDEN')
        logs[name] = log.open('ab')
        guarded = [sys.executable, str(Path(__file__).with_name('parent_guard.py')), str(os.getpid()), *commands[name]]
        children[name] = subprocess.Popen(guarded, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                           stdout=logs[name], stderr=logs[name], start_new_session=True, close_fds=True)
        identity = process_identity(children[name].pid)
        require(identity is not None and identity['group'] == identity['pid'], 'HOST_PROCESS_IDENTITY_UNCONFIRMED')
        identities[name] = identity
        record_children(state, list(identities.values()))
        print(json.dumps({'event': 'runtime_host.started', 'service': name}), flush=True)
    try:
        for name in commands: start(name)
        while not stopped.wait(poll):
            for name, child in list(children.items()):
                if child.poll() is None: continue
                # An orphaned worker must finish its drain before a replacement supervisor starts.
                clean_exit = stop_group(child, grace)
                require(clean_exit, 'HOST_DRAIN_FAILED')
                logs.pop(name).close()
                now = time.monotonic()
                while history[name] and now - history[name][0] > RESTART_WINDOW_SECONDS: history[name].popleft()
                require(len(history[name]) < MAX_RESTARTS, 'HOST_RESTART_BUDGET_EXHAUSTED')
                history[name].append(now)
                print(json.dumps({'event': 'runtime_host.restart', 'service': name, 'attempt': len(history[name])}), flush=True)
                if stopped.wait(restart_delay): break
                start(name)
    finally:
        # API closes before the worker supervisor, whose existing drain budget is 80 seconds.
        for name, child in children.items():
            try: clean = stop_group(child, grace) and clean
            except Exception: clean = False
        for log in logs.values(): log.close()
        if clean: record_children(state, [])
    require(clean, 'HOST_SHUTDOWN_UNCONFIRMED')


def run(path, env, stopped):
    import fcntl
    os.umask(0o077)
    config = runtime_configuration(path, env)
    child_env = process_environment(env)
    state = Path(config['stateDirectory'])
    lock_path = state / 'runtime-host.lock'
    require(not lock_path.is_symlink(), 'HOST_LOCK_LINK_FORBIDDEN')
    with lock_path.open('a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('RUNTIME_HOST_ALREADY_RUNNING') from None
        production_gate(config, child_env)
        recover_previous(state)
        dist = Path(config['sourceRoot']) / 'artifacts/api-server/dist'
        for name in ('index.mjs', 'export-supervisor.mjs', 'export-worker.mjs'):
            require((dist / name).is_file() and not (dist / name).is_symlink(), 'BUILT_RUNTIME_REQUIRED')
        commands = {'api': ['node', str(dist / 'index.mjs')], 'worker': ['node', str(dist / 'export-supervisor.mjs')]}
        supervise(commands, dist.parent, child_env, state, stopped)


if __name__ == '__main__':
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    try:
        require(len(sys.argv) == 2, 'HOST_CONFIG_PATH_REQUIRED')
        run(Path(sys.argv[1]), dict(os.environ), stopped)
    except Exception:
        print('RUNTIME_HOST_FAILED', file=sys.stderr)
        sys.exit(1)

"""Reserved VM entry point. Configuration must be supplied through deployment secrets.
No database creation/migration, provider provisioning or activation by defaults.
"""
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import threading
from recovery_archive import require
from runtime_host import run
from release_manifest import verify


def launch():
    os.umask(0o077)
    root = Path(__file__).resolve().parents[2]
    env = dict(os.environ)
    require(env.get('NODE_ENV') == 'production' and env.get('VALO_RUNTIME_ACTIVATION') == 'private-rehearsal-v1', 'EXPLICIT_REHEARSAL_REQUIRED')
    verify(root, env.get('VALO_RELEASE_SHA', ''))
    # Deployment starts without workspace recovery files or a dependency on Git metadata.
    require(not (root / 'generated-artifacts').exists(), 'CLEAN_PRODUCTION_APP_REQUIRED')
    state = Path(tempfile.gettempdir()) / 'valo-production-runtime'
    if not state.exists(): state.mkdir(mode=0o700)
    require(state == state.resolve() and state.is_dir() and state.stat().st_uid == os.getuid() and
            not state.stat().st_mode & 0o077, 'PRIVATE_HOST_STATE_REQUIRED')
    config = state / 'configuration.json'
    require(not config.is_symlink(), 'HOST_CONFIG_LINK_FORBIDDEN')
    config.write_text(json.dumps({'version': 1, 'sourceRoot': str(root), 'stateDirectory': str(state),
                                 'releaseSha': env['VALO_RELEASE_SHA'], 'mode': 'production'}))
    config.chmod(0o600)
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    run(config, env, stopped)


if __name__ == '__main__':
    try: launch()
    except Exception:
        print('PRODUCTION_REHEARSAL_START_FAILED', file=sys.stderr)
        sys.exit(1)

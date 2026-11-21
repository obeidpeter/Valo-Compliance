"""Pin built server and supervisor files; deployment startup needs no .git directory."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from recovery_archive import require


def files(root):
    paths = [*sorted((root / 'artifacts/api-server/dist').glob('*.mjs')),
             *sorted((root / 'scripts/ops').glob('*.py')), *sorted((root / 'scripts/ops').glob('*.mjs')),
             root / 'pnpm-lock.yaml', root / 'lib/db/drizzle/pg-boss-development.sql']
    require(all((root / 'artifacts/api-server/dist' / name).is_file() for name in
                ('index.mjs', 'export-worker.mjs', 'export-supervisor.mjs', 'production-preflight.mjs')), 'BUILT_RELEASE_REQUIRED')
    require(all(p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(root) for p in paths), 'RELEASE_FILE_INVALID')
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def verify(root, sha):
    path = root / 'artifacts/api-server/dist/release.json'
    require(path.is_file() and not path.is_symlink() and path.stat().st_size < 100000, 'RELEASE_MANIFEST_REQUIRED')
    data = json.loads(path.read_text())
    require(set(data) == {'version', 'releaseSha', 'files'} and data['version'] == 1 and
            re.fullmatch(r'[a-f0-9]{40}', sha) and data['releaseSha'] == sha and data['files'] == files(root), 'RELEASE_MANIFEST_MISMATCH')


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2, 'RELEASE_ROOT_REQUIRED')
        root = Path(sys.argv[1]).resolve()
        # A clean release checkout, not the development workspace with native overrides.
        result = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=root, capture_output=True, timeout=10)
        require(result.returncode == 0 and not result.stdout, 'CLEAN_RELEASE_CHECKOUT_REQUIRED')
        result = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True, timeout=10)
        sha = result.stdout.decode().strip()
        require(result.returncode == 0 and re.fullmatch(r'[a-f0-9]{40}', sha), 'RELEASE_SHA_REQUIRED')
        # These contain recovery dumps/keys on the development host. Never publish that workspace.
        require(not (root / 'generated-artifacts').exists(), 'CLEAN_PRODUCTION_APP_REQUIRED')
        data = {'version': 1, 'releaseSha': sha, 'files': files(root)}
        (root / 'artifacts/api-server/dist/release.json').write_text(json.dumps(data, sort_keys=True))
        verify(root, sha)
        print(json.dumps({'releaseSha': sha, 'filesPinned': len(data['files'])}))
    except Exception:
        print('RELEASE_MANIFEST_FAILED', file=sys.stderr)
        sys.exit(1)

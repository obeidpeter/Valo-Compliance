import json
from pathlib import Path
import tempfile
import unittest
from release_manifest import files, verify


class ReleaseManifestTest(unittest.TestCase):
    def test_gitless_release_rejects_changed_missing_and_added_executables(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();dist=root/'artifacts/api-server/dist';dist.mkdir(parents=True)
            ops=root/'scripts/ops';ops.mkdir(parents=True)
            for name in ('index.mjs','export-worker.mjs','export-supervisor.mjs','production-preflight.mjs'): (dist/name).write_text('synthetic')
            (ops/'runtime_host.py').write_text('synthetic');(root/'pnpm-lock.yaml').write_text('frozen')
            (ops/'export_retention_contract.mjs').write_text('synthetic recovery helper')
            sql=root/'lib/db/drizzle/pg-boss-development.sql';sql.parent.mkdir(parents=True);sql.write_text('pinned queue')
            sha='a'*40
            (dist/'release.json').write_text(json.dumps({'version':1,'releaseSha':sha,'files':files(root)}))
            verify(root,sha)
            for path in (dist/'index.mjs',ops/'runtime_host.py',ops/'export_retention_contract.mjs',root/'pnpm-lock.yaml'):
                old=path.read_text();path.write_text('changed')
                with self.assertRaisesRegex(Exception,'MISMATCH'): verify(root,sha)
                path.write_text(old)
            (dist/'extra.mjs').write_text('unexpected')
            with self.assertRaisesRegex(Exception,'MISMATCH'): verify(root,sha)
            with self.assertRaisesRegex(Exception,'MISMATCH'): verify(root,'b'*40)


if __name__=='__main__': unittest.main()

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from recovery_archive import ArchiveError, backup_and_verify, configuration, inspect_bundle, restic


class RecoveryArchiveTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="valo-archive-test-")
        self.root = Path(self.temp.name).resolve()
        self.bundle = self.root / "bundle"
        self.bundle.mkdir(mode=0o700)
        self.password = self.root / "independent-password"
        self.password.write_bytes(os.urandom(32).hex().encode("ascii"))
        self.password.chmod(0o600)
        content = b"SYNTHETIC private object fixture"
        object_hash = hashlib.sha256(content).hexdigest()
        (self.bundle / "objects").mkdir(mode=0o700)
        self.manifest = {"version": 1, "scope": "synthetic", "releaseSha": "a" * 40, "files": []}
        for name, value in {"database.dump": b"PGDMP-SYNTHETIC-FIXTURE-NOT-A-DATABASE",
                            "recovery-controls.json": b'{"synthetic":true,"notValidForReplay":true}',
                            "object-index.json": json.dumps({"objects": ["objects/" + object_hash + ".bin"]}).encode(),
                            "objects/" + object_hash + ".bin": content}.items():
            path = self.bundle / name
            path.write_bytes(value)
            path.chmod(0o600)
            self.manifest["files"].append({"path": name, "sha256": hashlib.sha256(value).hexdigest(), "bytes": len(value)})
        self.save_manifest()
        self.env = {**os.environ, "VALO_RECOVERY_ARCHIVE_MODE": "synthetic-local-only", "NODE_ENV": "test",
                    "REPLIT_DEPLOYMENT": "", "RESTIC_REPOSITORY": str(self.root / "repository"),
                    "RESTIC_PASSWORD_FILE": str(self.password)}

    def save_manifest(self):
        path = self.bundle / "manifest.json"
        path.write_text(json.dumps(self.manifest), encoding="utf-8")
        path.chmod(0o600)

    def tearDown(self):
        self.temp.cleanup()

    def test_bundle_requires_all_components_and_rejects_traversal_and_extra_secrets(self):
        self.assertEqual(len(inspect_bundle(self.bundle)[1]), 4)
        self.manifest["files"][0]["path"] = "../independent-password"
        self.save_manifest()
        with self.assertRaisesRegex(ArchiveError, "BUNDLE_PATH_INVALID"):
            inspect_bundle(self.bundle)
        self.manifest["files"][0]["path"] = "database.dump"
        self.save_manifest()
        (self.bundle / ".env").write_text("synthetic-unmanifested-secret")
        (self.bundle / ".env").chmod(0o600)
        with self.assertRaisesRegex(ArchiveError, "UNMANIFESTED_BUNDLE_FILE"):
            inspect_bundle(self.bundle)
        (self.bundle / ".env").unlink()
        (self.bundle / "database.dump").write_bytes(b"corrupt")
        with self.assertRaisesRegex(ArchiveError, "BUNDLE_CHECKSUM_MISMATCH"):
            inspect_bundle(self.bundle)

    @unittest.skipIf(os.name != "posix", "POSIX permissions and symlinks")
    def test_public_files_and_links_are_rejected(self):
        path = self.bundle / "database.dump"
        path.chmod(0o644)
        with self.assertRaisesRegex(ArchiveError, "PRIVATE_FILE_PERMISSIONS_REQUIRED"):
            inspect_bundle(self.bundle)
        path.unlink()
        path.symlink_to(self.password)
        with self.assertRaisesRegex(ArchiveError, "BUNDLE_LINK_FORBIDDEN"):
            inspect_bundle(self.bundle)

    def test_environment_excludes_application_credentials_and_command_overrides(self):
        env = {**self.env, "DATABASE_URL": "PRIVATE_DB", "RESTIC_PASSWORD_COMMAND": "must-not-execute",
               "RESTIC_REPOSITORY_FILE": "must-not-read", "AWS_SECRET_ACCESS_KEY": "PRIVATE_CLOUD",
               "HTTPS_PROXY": "http://private-proxy.invalid"}
        _, _, forwarded = configuration(env, self.bundle)
        for key in ("DATABASE_URL", "RESTIC_PASSWORD_COMMAND", "RESTIC_REPOSITORY_FILE", "AWS_SECRET_ACCESS_KEY", "HTTPS_PROXY"):
            self.assertNotIn(key, forwarded)
        for repository in ("rest:https://attacker.invalid/repo", str(self.bundle / "repo")):
            with self.assertRaises(ArchiveError):
                configuration({**self.env, "RESTIC_REPOSITORY": repository}, self.bundle)
        with self.assertRaisesRegex(ArchiveError, "LOCAL_SYNTHETIC_RUNTIME_REQUIRED"):
            configuration({**self.env, "REPLIT_DEPLOYMENT": "1"}, self.bundle)

    @unittest.skipIf(os.name != "posix", "approved backend requires POSIX")
    def test_b2_requires_exact_https_backend_and_separate_credentials(self):
        env = {**self.env, "VALO_RECOVERY_ARCHIVE_MODE": "approved-b2", "AWS_ACCESS_KEY_ID": "synthetic-key",
               "AWS_SECRET_ACCESS_KEY": "synthetic-secret", "RESTIC_REPOSITORY":
               "s3:https://s3.us-west-004.backblazeb2.com/synthetic-valo-backups/valo-development"}
        self.assertEqual(configuration(env, self.bundle)[1], "backblaze-b2-s3")
        for repository in (env["RESTIC_REPOSITORY"].replace("https:", "http:"),
                           env["RESTIC_REPOSITORY"].replace("backblazeb2.com", "backblazeb2.com.evil.invalid"),
                           env["RESTIC_REPOSITORY"] + "?private=secret"):
            with self.assertRaisesRegex(ArchiveError, "B2_REPOSITORY_INVALID"):
                configuration({**env, "RESTIC_REPOSITORY": repository}, self.bundle)

    def test_partial_or_failed_restic_output_cannot_be_success_and_is_redacted(self):
        for code in (1, 3, 10):
            result = subprocess.CompletedProcess([], code, b"private snapshot data", b"PRIVATE_PROVIDER_CREDENTIALS")
            with patch("recovery_archive.subprocess.run", return_value=result):
                with self.assertRaisesRegex(ArchiveError, "^RESTIC_OPERATION_FAILED$"):
                    restic(["backup"], {})

    @unittest.skipUnless(shutil.which("restic"), "real restic required in CI")
    def test_real_encrypted_archive_round_trip_wrong_password_and_missing_repository(self):
        _, _, child_env = configuration(self.env, self.bundle)
        restic(["init", "--repository-version", "2"], child_env)
        receipt = backup_and_verify(self.bundle, self.root / "receipt.json", self.env)
        self.assertTrue(receipt["restoredChecksumMatched"])
        self.assertFalse(receipt["offHostTransportVerified"])
        self.assertFalse(receipt["databaseRestoreValidated"])
        self.assertFalse(receipt["latestErasureReplayValidated"])
        self.assertFalse(receipt["independentHostRecoveryValidated"])
        self.assertNotIn(str(self.root), json.dumps(receipt))
        # A repository is encrypted: fixture contents do not occur in any stored file.
        for path in (self.root / "repository").rglob("*"):
            if path.is_file():
                self.assertNotIn(b"SYNTHETIC private object fixture", path.read_bytes())
        self.password.write_bytes(b"wrong-independent-password" * 3)
        with self.assertRaisesRegex(ArchiveError, "RESTIC_OPERATION_FAILED"):
            backup_and_verify(self.bundle, self.root / "wrong-password.json", self.env)
        self.assertFalse((self.root / "wrong-password.json").exists())
        with self.assertRaisesRegex(ArchiveError, "RESTIC_OPERATION_FAILED"):
            backup_and_verify(self.bundle, self.root / "missing-repo.json",
                              {**self.env, "RESTIC_REPOSITORY": str(self.root / "missing")})
        self.assertFalse((self.root / "missing").exists())


if __name__ == "__main__":
    if os.environ.get("VALO_REQUIRE_REAL_RESTIC") == "1" and not shutil.which("restic"):
        raise SystemExit("REAL_RESTIC_REQUIRED")
    unittest.main()

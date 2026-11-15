"""Encrypt and verify a PREPARED recovery bundle using the installed restic CLI.

Does not dump databases, copy live objects, capture/replay privacy controls, initialize
repositories, schedule jobs or delete snapshots. Those are separate reviewed steps.
No shell, credential arguments, raw provider logs, or inherited application secrets.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import uuid


class ArchiveError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise ArchiveError(code)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def private_regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink(), "PRIVATE_REGULAR_FILE_REQUIRED")
    if os.name == "posix":
        require(info.st_uid == os.getuid() and not info.st_mode & 0o077, "PRIVATE_FILE_PERMISSIONS_REQUIRED")
    return info


def configuration(env, bundle):
    mode = env.get("VALO_RECOVERY_ARCHIVE_MODE")
    require(mode in ("synthetic-local-only", "approved-b2"), "EXPLICIT_ARCHIVE_MODE_REQUIRED")
    password = Path(env.get("RESTIC_PASSWORD_FILE", ""))
    require(password.is_absolute() and password == password.resolve(), "PRIVATE_PASSWORD_FILE_REQUIRED")
    private_regular(password)
    require(not password.is_relative_to(bundle) and password.stat().st_size >= 32, "INDEPENDENT_PASSWORD_CUSTODY_REQUIRED")
    repository = env.get("RESTIC_REPOSITORY", "")
    # Only the environment needed by the executable and this chosen backend survives.
    child_env = {k: env[k] for k in ("PATH", "SystemRoot", "WINDIR", "TEMP", "TMP") if k in env}
    child_env.update(RESTIC_REPOSITORY=repository, RESTIC_PASSWORD_FILE=str(password))
    if mode == "synthetic-local-only":
        require(not env.get("REPLIT_DEPLOYMENT") and env.get("NODE_ENV") != "production", "LOCAL_SYNTHETIC_RUNTIME_REQUIRED")
        local = Path(repository)
        require(local.is_absolute() and local == local.resolve() and not local.is_relative_to(bundle)
                and not bundle.is_relative_to(local), "ISOLATED_LOCAL_REPOSITORY_REQUIRED")
        backend = "local-synthetic"
    else:
        require(os.name == "posix", "B2_RUNNER_REQUIRES_PRIVATE_POSIX_FILES")
        # HTTPS only, no arbitrary hosts, command backends, credentials or URL queries.
        require(re.fullmatch(r"s3:https://s3\.(?:us|eu)-[a-z]+-[0-9]{3}\.backblazeb2\.com/"
                             r"[a-zA-Z0-9-]{6,63}/valo-(?:development|production)", repository), "B2_REPOSITORY_INVALID")
        for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
            require(bool(env.get(key)), "B2_CREDENTIALS_REQUIRED")
            child_env[key] = env[key]
        child_env["AWS_EC2_METADATA_DISABLED"] = "true"
        backend = "backblaze-b2-s3"
    return mode, backend, child_env


def inspect_bundle(bundle):
    require(bundle.is_absolute() and bundle == bundle.resolve() and bundle.is_dir(), "CANONICAL_BUNDLE_DIRECTORY_REQUIRED")
    info = bundle.stat()
    if os.name == "posix":
        require(info.st_uid == os.getuid() and not info.st_mode & 0o077, "PRIVATE_BUNDLE_DIRECTORY_REQUIRED")
    manifest_path = bundle / "manifest.json"
    private_regular(manifest_path)
    require(manifest_path.stat().st_size <= 4_000_000, "MANIFEST_TOO_LARGE")
    manifest = json.loads(manifest_path.read_text("utf-8"))
    require(isinstance(manifest, dict) and set(manifest) == {"version", "scope", "releaseSha", "files"}
            and manifest["version"] == 1 and manifest["scope"] in ("synthetic", "development", "production")
            and isinstance(manifest["releaseSha"], str) and re.fullmatch(r"[a-f0-9]{40}", manifest["releaseSha"])
            and isinstance(manifest["files"], list), "MANIFEST_INVALID")
    files = {}
    for entry in manifest["files"]:
        require(isinstance(entry, dict) and set(entry) == {"path", "sha256", "bytes"}, "MANIFEST_ENTRY_INVALID")
        name, checksum, size = entry["path"], entry["sha256"], entry["bytes"]
        require(isinstance(name, str) and (name in ("database.dump", "recovery-controls.json", "object-index.json")
                or re.fullmatch(r"objects/[a-f0-9]{64}\.bin", name)), "BUNDLE_PATH_INVALID")
        require(name not in files and isinstance(checksum, str) and re.fullmatch(r"[a-f0-9]{64}", checksum)
                and type(size) is int and size >= 0, "MANIFEST_ENTRY_INVALID")
        path = bundle / name
        require(path.resolve() == path, "BUNDLE_LINK_FORBIDDEN")
        private_regular(path)
        require(path.stat().st_size == size and digest(path) == checksum, "BUNDLE_CHECKSUM_MISMATCH")
        files[name] = entry
    require({"database.dump", "recovery-controls.json", "object-index.json"}.issubset(files), "RECOVERY_COMPONENTS_REQUIRED")
    require(files["database.dump"]["bytes"] > 0 and files["recovery-controls.json"]["bytes"] > 0, "RECOVERY_COMPONENTS_REQUIRED")
    actual = set()
    for path in bundle.rglob("*"):
        require(not path.is_symlink(), "BUNDLE_LINK_FORBIDDEN")
        if path.is_dir():
            require(path == bundle / "objects", "UNEXPECTED_BUNDLE_DIRECTORY")
        else:
            private_regular(path)
            actual.add(path.relative_to(bundle).as_posix())
    require(actual == set(files) | {"manifest.json"}, "UNMANIFESTED_BUNDLE_FILE")
    # Index contents and control signatures are validated by the existing restore/replay
    # procedure. Their byte identity alone cannot prove completeness or freshness.
    return manifest, files


def restic(args, env, stdin=None):
    try:
        result = subprocess.run(["restic", "--no-cache", *args], env=env, stdin=stdin or subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3600, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise ArchiveError("RESTIC_EXECUTION_FAILED") from None
    require(result.returncode == 0, "RESTIC_OPERATION_FAILED")
    require(len(result.stdout) <= 4_000_000, "RESTIC_OUTPUT_LIMIT")
    return result.stdout


def create_tar(bundle, files, target):
    # Exclude filesystem ownership/host metadata and never follow links into the bundle.
    names = ["manifest.json", *sorted(files)]
    with tarfile.open(target, "w", format=tarfile.PAX_FORMAT) as archive:
        for name in names:
            path = bundle / name
            private_regular(path)
            require(path.resolve() == path, "BUNDLE_LINK_FORBIDDEN")
            item = tarfile.TarInfo(name)
            item.size, item.mode = path.stat().st_size, 0o600
            with path.open("rb") as stream:
                archive.addfile(item, stream)
    target.chmod(0o600)


def verify_tar(path, manifest, files):
    with tarfile.open(path, "r") as archive:
        entries = archive.getmembers()
        require(len(entries) == len(files) + 1 and {e.name for e in entries} == set(files) | {"manifest.json"}
                and all(e.isfile() for e in entries), "ARCHIVE_CONTENTS_INVALID")
        for entry in entries:
            stream = archive.extractfile(entry)
            require(stream is not None, "ARCHIVE_CONTENTS_INVALID")
            with stream:
                if entry.name == "manifest.json":
                    require(json.load(stream) == manifest, "ARCHIVE_MANIFEST_MISMATCH")
                else:
                    require(entry.size == files[entry.name]["bytes"] and hashlib.file_digest(stream, "sha256").hexdigest()
                            == files[entry.name]["sha256"], "ARCHIVE_CHECKSUM_MISMATCH")


def backup_and_verify(bundle, receipt_path, env):
    manifest, files = inspect_bundle(bundle)
    mode, backend, child_env = configuration(env, bundle)
    require(mode != "synthetic-local-only" or manifest["scope"] == "synthetic", "SYNTHETIC_BUNDLE_REQUIRED")
    if mode == "approved-b2":
        require(manifest["scope"] in ("development", "production") and
                child_env["RESTIC_REPOSITORY"].endswith("/valo-" + manifest["scope"]), "B2_SCOPE_MISMATCH")
    require(receipt_path.is_absolute() and receipt_path == receipt_path.resolve() and not receipt_path.exists()
            and not receipt_path.is_relative_to(bundle) and receipt_path.parent.is_dir(), "NEW_PRIVATE_RECEIPT_PATH_REQUIRED")
    run_id = str(uuid.uuid4())
    # New independent restore directory and --no-cache force repository read-back.
    # Nothing is restored into the source or into a live database/object namespace.
    with tempfile.TemporaryDirectory(prefix="valo-archive-") as scratch_name:
        scratch = Path(scratch_name)
        archive = scratch / "recovery-bundle.tar"
        create_tar(bundle, files, archive)
        verify_tar(archive, manifest, files)
        checksum = digest(archive)
        with archive.open("rb") as stream:
            output = restic(["backup", "--stdin", "--stdin-filename", "recovery-bundle.tar", "--host", "valo-recovery",
                             "--tag", "valo-" + manifest["scope"] + "-recovery-v1", "--tag", run_id, "--json"], child_env, stream)
        summaries = [json.loads(line) for line in output.splitlines() if line.strip()]
        snapshots = [v.get("snapshot_id") for v in summaries if isinstance(v, dict) and v.get("message_type") == "summary"]
        require(len(snapshots) == 1 and isinstance(snapshots[0], str) and re.fullmatch(r"[a-f0-9]{64}", snapshots[0]), "RESTIC_SNAPSHOT_UNCONFIRMED")
        snapshot = snapshots[0]
        restored = scratch / "restore"
        restic(["restore", snapshot, "--target", str(restored), "--verify"], child_env)
        restored_tar = restored / "recovery-bundle.tar"
        require(restored_tar.is_file() and not restored_tar.is_symlink(), "RESTORED_ARCHIVE_INVALID")
        # stdin snapshots have restic's default file mode; scratch is already 0700.
        restored_tar.chmod(0o600)
        private_regular(restored_tar)
        require(digest(restored_tar) == checksum, "RESTORED_ARCHIVE_CHECKSUM_MISMATCH")
        verify_tar(restored_tar, manifest, files)
        receipt = {"version": 1, "runId": run_id, "status": "verified", "backend": backend,
                   "scope": manifest["scope"], "releaseSha": manifest["releaseSha"], "snapshotId": snapshot,
                   "bundleSha256": checksum, "fileCount": len(files), "restoredChecksumMatched": True,
                   "offHostTransportVerified": mode == "approved-b2", "independentHostRecoveryValidated": False,
                   "databaseRestoreValidated": False, "latestErasureReplayValidated": False,
                   "secretCustodyValidated": False}
        descriptor = os.open(receipt_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(receipt, stream, indent=2)
            stream.write("\n")
        return receipt


def main():
    try:
        require(len(sys.argv) == 4 and sys.argv[1] == "backup-and-verify", "ARCHIVE_ARGUMENTS_INVALID")
        receipt = backup_and_verify(Path(sys.argv[2]), Path(sys.argv[3]), dict(os.environ))
        print(json.dumps(receipt))
    except ArchiveError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        # Paths, control contents, credentials and subprocess stderr remain private.
        print("ARCHIVE_FAILED", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

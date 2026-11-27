"""The operator's journal: who ran a recovery or backup tool, on what, why, and what came of it (ADM-009).

A tool that restores or removes backups takes the operator's name and their reason, and writes an entry
here before it acts and another when it has finished or failed. It acts only once its first entry is on
disk, so nothing is restored or removed without a record of who asked and why.

The journal is one file of JSON lines in a private directory, `VALO_OPERATOR_JOURNAL`, which only the
operator's account can read or write. It is only ever appended to. Each entry holds the SHA-256 of the
entry before it and its own, so an entry changed or removed anywhere but at the end breaks the chain,
which `verify` finds before every write. It records no secret: no password, key or repository credential.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
from recovery_archive import private_regular, require

JOURNAL_NAME = "operator-journal.jsonl"
GENESIS = "0" * 64
# A short handle for the person, such as their sign-in name; never an email address or a secret.
OPERATOR = re.compile(r"[a-z][a-z0-9._-]{1,62}[a-z0-9]")
OUTCOMES = ("started", "completed", "failed")


def operator_record(operator, reason):
    """The operator and their reason, refused unless both are given in the form the journal keeps."""
    require(isinstance(operator, str) and OPERATOR.fullmatch(operator) is not None and "@" not in operator,
            "OPERATOR_REQUIRED")
    require(isinstance(reason, str) and 20 <= len(reason.strip()) <= 1000 and not re.search(r"[\r\n\x00]", reason),
            "OPERATOR_REASON_REQUIRED")
    return {"operator": operator, "reason": reason.strip()}


def journal_directory(env):
    """The journal's directory: absolute, existing, and private to the account running the tool."""
    raw = env.get("VALO_OPERATOR_JOURNAL", "")
    require(raw != "", "OPERATOR_JOURNAL_REQUIRED")
    path = Path(raw)
    require(path.is_absolute() and path == path.resolve() and path.is_dir(), "OPERATOR_JOURNAL_REQUIRED")
    if os.name == "posix":
        info = path.stat()
        require(info.st_uid == os.getuid() and not info.st_mode & 0o077, "PRIVATE_OPERATOR_JOURNAL_REQUIRED")
    return path


def _canonical(entry):
    return json.dumps(entry, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _sha256(entry):
    return hashlib.sha256(_canonical(entry).encode("ascii")).hexdigest()


def verify(directory):
    """Reads the whole journal and checks its chain; returns how many entries it holds and the last hash."""
    path = directory / JOURNAL_NAME
    if not path.exists():
        return {"entries": 0, "lastSha256": GENESIS}
    private_regular(path)
    previous, count = GENESIS, 0
    with open(path, "rb") as journal:
        for line in journal:
            require(line.endswith(b"\n"), "OPERATOR_JOURNAL_CHAIN_BROKEN")
            try:
                entry = json.loads(line.decode("ascii"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                require(False, "OPERATOR_JOURNAL_CHAIN_BROKEN")
            require(isinstance(entry, dict) and entry.get("previousSha256") == previous, "OPERATOR_JOURNAL_CHAIN_BROKEN")
            body = {key: value for key, value in entry.items() if key != "sha256"}
            require(entry.get("sha256") == _sha256(body) and _canonical(entry) + "\n" == line.decode("ascii"),
                    "OPERATOR_JOURNAL_CHAIN_BROKEN")
            previous, count = entry["sha256"], count + 1
    return {"entries": count, "lastSha256": previous}


def append(directory, who, command, target, outcome, details, at=None):
    """Appends one entry to an intact journal and returns it once it is on disk.

    `who` is an `operator_record`; `target` names what the command acts on, such as `backup_plan:<sha256>`.
    On a POSIX host the journal is locked while it is checked and written, so two operators' entries
    never take the same place in the chain.
    """
    require(re.fullmatch(r"[a-z][a-z_]{2,40}", command) is not None, "OPERATOR_COMMAND_INVALID")
    require(isinstance(target, str) and re.fullmatch(r"[a-z][a-z_]*:[^\s]{1,200}", target) is not None,
            "OPERATOR_TARGET_INVALID")
    require(outcome in OUTCOMES and isinstance(details, dict), "OPERATOR_ENTRY_INVALID")
    path = directory / JOURNAL_NAME
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        if os.name == "posix":
            import fcntl

            fcntl.flock(descriptor, fcntl.LOCK_EX)
        state = verify(directory)
        entry = {"version": 1, "at": (at or datetime.datetime.now(datetime.timezone.utc)).isoformat(),
                 "operator": who["operator"], "reason": who["reason"], "command": command, "target": target,
                 "outcome": outcome, "details": details, "previousSha256": state["lastSha256"]}
        entry["sha256"] = _sha256(entry)
        line = (_canonical(entry) + "\n").encode("ascii")
        require(os.write(descriptor, line) == len(line), "OPERATOR_JOURNAL_WRITE_FAILED")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return entry


def error_code(error):
    """The stable code of a refusal, never its free text, for a failed entry."""
    text = str(error)
    return text if re.fullmatch(r"[A-Z_]{3,60}", text) else type(error).__name__


if __name__ == "__main__":
    import sys

    try:
        require(len(sys.argv) == 2 and sys.argv[1] == "verify", "VERIFY_ARGUMENT_REQUIRED")
        print(json.dumps(verify(journal_directory(dict(os.environ)))))
    except Exception as error:
        print(error_code(error), file=sys.stderr)
        sys.exit(1)

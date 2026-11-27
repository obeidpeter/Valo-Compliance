#!/usr/bin/env python3
"""Read-only Git audit. Emits locations and rule names, never matched values."""
import datetime
import json
import pathlib
import re
import subprocess


def git(*args):
    return subprocess.check_output(["git", *args])


RULES = {
    "provider-token": r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,})",
    "private-key": r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----",
    "credential-url": r"(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|https?)://[^\s/:\"'<>]+:[^\s/@\"'<>]+@",
    "jwt": r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}",
    "literal-secret": r"""(?i)(?:password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token|secret[_-]?key|session[_-]?secret)\s*["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']""",
    "unquoted-secret": r"""(?im)^\s*(?:[A-Z0-9]+_)*(?:PASSWORD|SECRET|TOKEN|API_KEY|ACCESS_KEY)\s*[:=]\s*[^ \t\r\n"'${][^\s,;]{7,}""",
    "email": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
    "confidential-marker": r"(?i)\b(?:confidential|strictly private|patient record|social security|bank account|customer data)\b",
}
compiled = {key: re.compile(value) for key, value in RULES.items()}


def inspect(data, location):
    # Latin-1 preserves byte offsets and permits scanning binary bytes as well.
    text = data.decode("latin-1")
    return [
        {**location, "rule": rule, "line": text.count("\n", 0, match.start()) + 1}
        for rule, pattern in compiled.items()
        for match in pattern.finditer(text)
    ]


def main():
    commits = git("rev-list", "--all").decode().splitlines()
    objects = git("rev-list", "--objects", "--all").decode().splitlines()
    findings, inventory, binary, messages = [], [], [], []
    total = 0
    for item in objects:
        oid, _, path = item.partition(" ")
        if git("cat-file", "-t", oid).strip() != b"blob":
            continue
        data = git("cat-file", "blob", oid)
        total += len(data)
        inventory.append({"oid": oid, "path": path, "bytes": len(data)})
        if b"\0" in data:
            binary.append({"oid": oid, "path": path, "bytes": len(data)})
        findings.extend(inspect(data, {"oid": oid, "path": path}))
    for commit in commits:
        messages.extend(inspect(git("cat-file", "commit", commit), {"commit": commit}))
    current = []
    paths = git("ls-files", "-z").decode().split("\0")
    for path in filter(None, paths):
        file = pathlib.Path(path)
        if file.is_file() and not file.is_symlink():
            current.extend(inspect(file.read_bytes(), {"path": path}))
    result = {
        "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "head": git("rev-parse", "HEAD").decode().strip(),
        "shallow": git("rev-parse", "--is-shallow-repository").decode().strip(),
        "refs": git("for-each-ref", "--format=%(refname) %(objectname)").decode().splitlines(),
        "commits": commits, "blobCount": len(inventory), "blobBytes": total,
        "trackedCurrentFiles": len(list(filter(None, paths))),
        "rules": RULES, "inventory": inventory, "binaryBlobs": binary,
        "historicalFindings": findings, "commitMetadataFindings": messages,
        "currentFindings": current,
        "limits": "Heuristic regex audit, not a comprehensive secret detector. Binary bytes scanned but embedded/compressed content not extracted. Ignored/untracked files, unreachable objects, deleted remote refs, external storage and runtime secrets excluded. Paths in inventory are one representative name per blob.",
    }
    output = pathlib.Path("docs/valo/evidence/public-exposure-history.json")
    output.write_text(json.dumps(result, indent=2) + "\n")
    # Keep the full inventory in its restricted evidence file, not routine stdout.
    print('{"status":"evidence_written"}')


if __name__ == "__main__":
    main()

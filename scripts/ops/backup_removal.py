"""Remove the backup snapshots a reviewed retention plan removes, then prune their data.

The owner approved the 35-day retention policy on 2026-11-20 (docs/valo/release-and-rollback.md).
backup_retention.py plans it and deletes nothing; this is the separate step that removes. The
operator reviews a plan, then passes it with its SHA-256, so only what they reviewed can go:

- the plan must be one backup_retention.py printed, under the current policy, at most a day old;
- the repository's snapshots are read again and planned again now: each snapshot the reviewed plan
  removes must still exist and still be one the current plan removes, or nothing is removed;
- a group whose backups have stopped (BACKUPS_STALE) keeps everything, and the newest snapshot of
  each group, and any snapshot without a Valo backup tag, is never removed;
- after `restic forget` and `restic prune`, the snapshots are read again: the removed ones must be
  gone and every one the plan keeps must remain.

It never initializes a repository, schedules itself or reads application secrets. The repository and
its credentials come from the same checked environment as the recovery archive
(recovery_archive.configuration), with the plan's folder kept apart from both.
"""
import datetime
import hashlib
import json
from pathlib import Path
import re
import sys
from backup_retention import POLICY, plan
from recovery_archive import ArchiveError, configuration, private_regular, require, restic

MAX_PLAN_AGE = datetime.timedelta(hours=24)


def reviewed_plan(path, confirmed_sha256, now):
    """The plan the operator reviewed, refused unless its bytes have the hash they confirmed."""
    require(isinstance(confirmed_sha256, str) and re.fullmatch(r"[a-f0-9]{64}", confirmed_sha256),
            "PLAN_CONFIRMATION_REQUIRED")
    private_regular(path)
    require(path.stat().st_size < 10_000_000, "PLAN_TOO_LARGE")
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == confirmed_sha256, "PLAN_CONFIRMATION_MISMATCH")
    reviewed = json.loads(raw.decode("utf-8"))
    require(isinstance(reviewed, dict) and reviewed.get("version") == 1 and reviewed.get("policy") == POLICY
            and reviewed.get("snapshotsRemoved") == 0 and isinstance(reviewed.get("groups"), dict),
            "PLAN_INVALID")
    planned_at = datetime.datetime.fromisoformat(str(reviewed.get("plannedAt")))
    require(planned_at.tzinfo is not None, "PLAN_INVALID")
    require(planned_at <= now + datetime.timedelta(minutes=5), "PLAN_IN_FUTURE")
    require(now - planned_at <= MAX_PLAN_AGE, "PLAN_TOO_OLD")
    for group in reviewed["groups"].values():
        require(isinstance(group, dict) and group.get("status") in ("OK", "BACKUPS_STALE")
                and isinstance(group.get("keep"), list) and isinstance(group.get("remove"), list),
                "PLAN_INVALID")
    return reviewed


def snapshots(env):
    listing = json.loads(restic(["snapshots", "--json"], env).decode("utf-8"))
    require(isinstance(listing, list), "SNAPSHOT_LISTING_INVALID")
    return listing


def removals(reviewed, current):
    """The snapshots both plans remove, refused when the repository no longer matches the review."""
    chosen = []
    for name, group in sorted(reviewed["groups"].items()):
        if not group["remove"]:
            continue
        fresh = current["groups"].get(name)
        require(fresh is not None, "PLAN_NO_LONGER_CURRENT")
        require(group["status"] == "OK" and fresh["status"] == "OK", "BACKUPS_STALE")
        require(set(group["remove"]) <= set(fresh["remove"]), "PLAN_NO_LONGER_CURRENT")
        require(len(fresh["keep"]) > 0, "NEWEST_SNAPSHOT_REQUIRED")
        chosen.extend(group["remove"])
    return chosen


def remove(plan_path, confirmed_sha256, env, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    reviewed = reviewed_plan(plan_path, confirmed_sha256, now)
    mode, backend, child_env = configuration(env, plan_path.parent)
    current = plan(snapshots(child_env), now)
    chosen = removals(reviewed, current)
    kept = [i for group in current["groups"].values() for i in group["keep"]] + current["unknownSnapshots"]
    if chosen:
        restic(["forget", *chosen], child_env)
        restic(["prune"], child_env)
    remaining = {snapshot["id"] for snapshot in snapshots(child_env)}
    require(not remaining & set(chosen), "SNAPSHOT_REMOVAL_UNVERIFIED")
    require(set(kept) <= remaining, "KEPT_SNAPSHOT_MISSING")
    return {"version": 1, "mode": mode, "backend": backend, "policy": dict(POLICY),
            "plannedAt": reviewed["plannedAt"], "removedAt": now.isoformat(),
            "planSha256": confirmed_sha256, "snapshotsRemoved": len(chosen), "removed": sorted(chosen),
            "snapshotsKept": len(kept), "pruned": bool(chosen)}


if __name__ == "__main__":
    import os
    try:
        require(len(sys.argv) == 3, "PLAN_PATH_AND_SHA256_REQUIRED")
        print(json.dumps(remove(Path(sys.argv[1]).resolve(), sys.argv[2], dict(os.environ)), indent=2))
    except (ArchiveError, ValueError, OSError, json.JSONDecodeError) as error:
        code = str(error) if re.fullmatch(r"[A-Z_]{3,60}", str(error)) else "BACKUP_REMOVAL_FAILED"
        print(code, file=sys.stderr)
        sys.exit(1)

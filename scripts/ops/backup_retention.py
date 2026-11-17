"""Dry-run backup retention planner. It plans; it never deletes.

Reads the JSON that `restic snapshots --json` prints, so it needs no repository
credentials, and reports which snapshots the proposed policy would keep or remove.
Removing snapshots stays a separate step that needs owner approval of the policy
(`RETENTION_POLICY_AND_RELEASE_APPROVAL` in the production preflight). The backup
cycle still never prunes.

Proposed policy (docs/valo/release-and-rollback.md):
- keep every snapshot from the last 48 hours;
- keep the newest snapshot of each UTC day for 35 days;
- remove anything older, so that erased customer data leaves the backups within
  35 days.

Safety rules that hold whatever the policy says:
- each group (database/files archive, privacy journal; per scope) is planned on
  its own, and its newest snapshot is always kept;
- when a group's newest snapshot is older than 48 hours, backups have stopped and
  the group keeps everything (BACKUPS_STALE) until a backup succeeds again;
- snapshots without a Valo backup tag are left alone and listed;
- malformed input, duplicate IDs or snapshot times in the future stop the plan.
"""
import datetime
import json
from pathlib import Path
import re
import sys
from recovery_archive import require

POLICY = {'version': 1, 'keepAllHours': 48, 'keepDailyDays': 35}
GROUP_TAG = re.compile(r'valo-(development|production)-(recovery|privacy-journal)-v1')
RESTIC_TIME = re.compile(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)')


def snapshot_time(value):
    match = RESTIC_TIME.fullmatch(value) if isinstance(value, str) else None
    require(match, 'SNAPSHOT_TIME_INVALID')
    microseconds = (match.group(2) or '0')[:6].ljust(6, '0')
    zone = '+00:00' if match.group(3) == 'Z' else match.group(3)
    parsed = datetime.datetime.fromisoformat(f'{match.group(1)}.{microseconds}{zone}')
    return parsed.astimezone(datetime.timezone.utc)


def snapshot_group(snapshot):
    tags = snapshot.get('tags') or []
    require(isinstance(tags, list) and all(isinstance(tag, str) for tag in tags), 'SNAPSHOT_TAGS_INVALID')
    groups = {tag for tag in tags if GROUP_TAG.fullmatch(tag)}
    require(len(groups) <= 1, 'SNAPSHOT_GROUP_AMBIGUOUS')
    return groups.pop() if groups else None


def plan(snapshots, now, policy=POLICY):
    require(isinstance(snapshots, list) and now.tzinfo is not None, 'RETENTION_INPUT_INVALID')
    keep_all = datetime.timedelta(hours=policy['keepAllHours'])
    keep_daily = datetime.timedelta(days=policy['keepDailyDays'])
    require(datetime.timedelta(0) < keep_all < keep_daily, 'RETENTION_POLICY_INVALID')
    groups, unknown, seen = {}, [], set()
    for snapshot in snapshots:
        require(isinstance(snapshot, dict), 'SNAPSHOT_INVALID')
        snapshot_id = snapshot.get('id')
        require(isinstance(snapshot_id, str) and re.fullmatch(r'[a-f0-9]{64}', snapshot_id), 'SNAPSHOT_ID_INVALID')
        require(snapshot_id not in seen, 'SNAPSHOT_ID_DUPLICATE')
        seen.add(snapshot_id)
        taken = snapshot_time(snapshot.get('time'))
        # A clock problem must never make old snapshots look removable.
        require(taken <= now + datetime.timedelta(minutes=5), 'SNAPSHOT_TIME_IN_FUTURE')
        group = snapshot_group(snapshot)
        if group is None:
            unknown.append(snapshot_id)
        else:
            groups.setdefault(group, []).append((taken, snapshot_id))
    planned = {}
    for group, members in sorted(groups.items()):
        members.sort(reverse=True)
        if now - members[0][0] > keep_all:
            planned[group] = {'status': 'BACKUPS_STALE', 'keep': [i for _, i in members], 'remove': []}
            continue
        keep, remove, days = [], [], set()
        for taken, snapshot_id in members:
            age = now - taken
            if age <= keep_all or (age <= keep_daily and taken.date() not in days):
                keep.append(snapshot_id)
                days.add(taken.date())
            else:
                remove.append(snapshot_id)
        planned[group] = {'status': 'OK', 'keep': keep, 'remove': remove}
    return {'version': 1, 'policy': dict(policy), 'plannedAt': now.isoformat(), 'groups': planned,
            'unknownSnapshots': unknown, 'snapshotsRemoved': 0}


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2, 'SNAPSHOT_LISTING_PATH_REQUIRED')
        listing = Path(sys.argv[1])
        require(listing.is_file() and not listing.is_symlink() and listing.stat().st_size < 10_000_000,
                'SNAPSHOT_LISTING_INVALID')
        result = plan(json.loads(listing.read_text('utf-8')), datetime.datetime.now(datetime.timezone.utc))
        print(json.dumps(result, indent=2))
    except Exception as error:
        code = str(error) if re.fullmatch(r'[A-Z_]{3,60}', str(error)) else 'RETENTION_PLAN_FAILED'
        print(code, file=sys.stderr)
        sys.exit(1)

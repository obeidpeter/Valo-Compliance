#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p generated-artifacts/valo-security
# Source only: never execute the harmless detector canary.
printf '%s\n' 'eval("synthetic-detector-canary");' > "$scratch/canary.js"
set +e
semgrep scan --config .semgrep/valo.yml --metrics=off --disable-version-check --error --json "$scratch/canary.js" > "$scratch/canary.json" 2>/dev/null
canary_status=$?
set -e
test "$canary_status" = 1
python - "$scratch/canary.json" <<'PY'
import json,sys
assert len(json.load(open(sys.argv[1]))["results"]) > 0
PY
set +e
semgrep scan --config p/ci --config .semgrep/valo.yml --metrics=off --disable-version-check --error --json \
  --exclude .local --exclude .agents --exclude generated-artifacts --exclude '**/generated-artifacts/**' . > "$scratch/raw.json"
scan_status=$?
set -e
python - "$scratch/raw.json" generated-artifacts/valo-security/merge-static.json "$scan_status" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
safe={"canaryDetected":True,"exitCode":int(sys.argv[3]),"passed":int(sys.argv[3])==0,
      "source":"Semgrep p/ci plus committed Valo rules; raw source/matches excluded",
      "findings":[{"id":x["check_id"],"file":x["path"],"line":x["start"]["line"],"severity":x["extra"]["severity"]} for x in r.get("results",[])],
      "errors":[{"type":x.get("type"),"code":x.get("code")} for x in r.get("errors",[])]}
with open(sys.argv[2],"w") as f:json.dump(safe,f,indent=2)
PY
exit "$scan_status"

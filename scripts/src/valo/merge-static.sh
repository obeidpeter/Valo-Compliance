#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p generated-artifacts/valo-security
report="$root/generated-artifacts/valo-security/merge-static.json"
printf '%s\n' 'eval("synthetic-detector-canary");' > "$scratch/canary.js"
# Explicit JSON output files: scanner startup/CLI errors need not emit stdout.
# Keep raw stderr/matches temporary; every failure leaves a sanitized report.
run_scan() {
  set +e
  semgrep scan "$@" --metrics=off --disable-version-check --error \
    --json-output="$scratch/result.json" >"$scratch/stdout" 2>"$scratch/stderr"
  scan_status=$?
  set -e
}
run_scan --config .semgrep/valo.yml --no-git-ignore "$scratch/canary.js"
python - "$scratch/result.json" "$report" "$scan_status" canary <<'PY'
import json,sys
try:
    r=json.load(open(sys.argv[1]))
    detected=int(sys.argv[3])==1 and any(x.get("check_id","").endswith("valo-no-runtime-eval") for x in r.get("results",[])) and not r.get("errors")
except (OSError,ValueError):
    detected=False
with open(sys.argv[2],"w") as f:
    json.dump({"phase":"canary","canaryDetected":detected,"passed":False,"exitCode":int(sys.argv[3]),"scannerFailure":not detected},f,indent=2)
sys.exit(0 if detected else 2)
PY
rm -f "$scratch/result.json"
run_scan --config p/ci --config .semgrep/valo.yml \
  --exclude .local --exclude .agents --exclude generated-artifacts --exclude '**/generated-artifacts/**' .
python - "$scratch/result.json" "$report" "$scan_status" <<'PY'
import json,sys
try:
    r=json.load(open(sys.argv[1]))
except (OSError,ValueError):
    r={"errors":[{"type":"ScannerOutputUnavailable","code":2}]}
safe={"phase":"repository","canaryDetected":True,"exitCode":int(sys.argv[3]),
      "passed":int(sys.argv[3])==0 and not r.get("errors") and not r.get("results"),
      "source":"Semgrep p/ci plus committed Valo rules; raw source/matches excluded",
      "findings":[{"id":x["check_id"],"file":x["path"],"line":x["start"]["line"],"severity":x["extra"]["severity"]} for x in r.get("results",[])],
      "errors":[{"type":x.get("type"),"code":x.get("code")} for x in r.get("errors",[])]}
with open(sys.argv[2],"w") as f:json.dump(safe,f,indent=2)
sys.exit(0 if safe["passed"] else 1)
PY

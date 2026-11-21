import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Fault-injection tests for the driver, separate from a real Semgrep execution.
for (const scenario of [
  "startup-failure",
  "wrong-canary",
  "empty-canary",
  "repository-failure",
  "finding",
  "clear",
]) {
  test(`static driver keeps an honest sanitized outcome: ${scenario}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "valo-static-driver-"));
    const marker = "SYNTHETIC_PRIVATE_SCANNER_MARKER";
    try {
      const env = {
        PATH: join(dir, "bin") + ":" + process.env.PATH,
        HOME: process.env.HOME,
        DANGEROUSLY_ALLOW_GIT: "1",
        VALO_STATIC_TEST_SCENARIO: scenario,
      };
      const init = spawnSync("git", ["init", "--quiet", dir], { env, encoding: "utf8" });
      assert.equal(init.status, 0);
      await mkdir(join(dir, "bin"));
      await mkdir(join(dir, ".semgrep"));
      await copyFile(new URL("./merge-static.sh", import.meta.url), join(dir, "driver.sh"));
      await writeFile(
        join(dir, "bin/semgrep"),
        `#!/usr/bin/env node
const fs=require("node:fs");
const scenario=process.env.VALO_STATIC_TEST_SCENARIO;
const output=process.argv.find(x=>x.startsWith("--json-output=")).split("=").slice(1).join("=");
const canary=process.argv.some(x=>x.endsWith("/canary.js"));
if((canary&&scenario==="startup-failure")||(!canary&&scenario==="repository-failure")){
 process.stderr.write("${marker}");process.exit(2);
}
const finding={check_id:canary&&scenario!=="wrong-canary"?"rules.valo-no-runtime-eval":"other-rule",
 path:"fixture.ts",start:{line:7},extra:{severity:"ERROR",message:"${marker}"},lines:"${marker}"};
const found=canary?scenario!=="empty-canary":scenario==="finding";
fs.writeFileSync(output,JSON.stringify({results:found?[finding]:[],errors:[]}));
process.exit(found?1:0);
`,
        { mode: 0o700 },
      );
      const run = spawnSync("bash", ["driver.sh"], { cwd: dir, env, encoding: "utf8", timeout: 30000 });
      const raw = await readFile(join(dir, "generated-artifacts/valo-security/merge-static.json"), "utf8");
      const result = JSON.parse(raw);
      assert.equal(raw.includes(marker), false);
      assert.equal((run.stdout + run.stderr).includes(marker), false);
      assert.equal(result.passed, scenario === "clear");
      assert.equal(run.status === 0, scenario === "clear");
      assert.equal(
        result.canaryDetected,
        !["startup-failure", "wrong-canary", "empty-canary"].includes(scenario),
      );
      if (scenario === "finding")
        assert.deepEqual(result.findings, [
          { id: "other-rule", file: "fixture.ts", line: 7, severity: "ERROR" },
        ]);
      if (scenario === "repository-failure")
        assert.deepEqual(result.errors, [{ type: "ScannerOutputUnavailable", code: 2 }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

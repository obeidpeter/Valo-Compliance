import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { repositoryRoot } from "./architecture-check";
import { WORKFLOW } from "./database-tests";
import { SBOM_FILE } from "./sbom";

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, string> };
type Workflow = { on: Record<string, unknown>; jobs: Record<string, { if?: string; steps?: Step[] }> };

const SCANS = ["merge-security", "merge-static"];

test("every week the workflow runs the dependency, secret and static checks, and nothing else (SEC-007)", () => {
  const workflow = parse(readFileSync(join(repositoryRoot, WORKFLOW), "utf8")) as Workflow;
  // Once a week, at a fixed minute, hour and weekday.
  const schedule = workflow.on.schedule as { cron: string }[];
  assert.equal(schedule.length, 1);
  assert.match(schedule[0]!.cron, /^\d{1,2} \d{1,2} \* \* [0-6]$/);
  // The scans run on every trigger, the schedule included; every other job skips the schedule.
  for (const [id, job] of Object.entries(workflow.jobs))
    if (SCANS.includes(id)) assert.equal(job.if, undefined, `${id} has a condition`);
    else assert.match(String(job.if), /github\.event_name != 'schedule'/, `${id} runs on the schedule`);
  // What they run: the audit with its records, the secret scan, the static rules and the bill of
  // materials, which is kept with the run.
  const runs = (id: string) => (workflow.jobs[id]!.steps ?? []).map((step) => step.run ?? "").join("\n");
  assert.match(runs("merge-security"), /tsx src\/valo\/merge-security\.ts/);
  assert.match(runs("merge-security"), /tsx src\/valo\/sbom\.ts/);
  assert.match(runs("merge-static"), /scripts\/src\/valo\/merge-static\.sh/);
  const kept = workflow.jobs["merge-security"]!.steps!.find(
    (step) =>
      step.uses?.startsWith("actions/upload-artifact@") && step.with?.name === "software-bill-of-materials",
  );
  assert.equal(kept?.with?.path, SBOM_FILE);
});

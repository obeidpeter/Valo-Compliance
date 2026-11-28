// OPS-008: names the release this change would be rolled back to, for the rollback job
// (docs/architecture/rollback.md).
//
//   node scripts/ops/previous_release.mjs >> "$GITHUB_ENV"
//
// prints VALO_PREVIOUS_RELEASE=<commit> for the event the workflow runs for, as the job's own
// settings give it (EVENT, BASE, BEFORE and REF):
// - a pull request: the commit of the branch it would merge into;
// - a push to the integration branch or to main: the commit that branch held before the push;
// - any other push, or a run asked for by hand: where the branch leaves the integration branch.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const INTEGRATION = "feature/valo-p0-foundation";
const COMMIT = /^[0-9a-f]{40}$/;
const NO_COMMIT = "0".repeat(40);

export function previousRelease({ event, base, before, ref }, mergeBase) {
  if (event === "pull_request") {
    if (!COMMIT.test(base ?? ""))
      throw Error("PREVIOUS_RELEASE_UNKNOWN: the pull request names no base commit");
    return base;
  }
  if (event !== "push" && event !== "workflow_dispatch")
    throw Error(`PREVIOUS_RELEASE_UNKNOWN: no previous release is named for a ${event} event`);
  const released = [`refs/heads/${INTEGRATION}`, "refs/heads/main"].includes(ref);
  if (event === "push" && released && COMMIT.test(before ?? "") && before !== NO_COMMIT) return before;
  const found = mergeBase().trim();
  if (!COMMIT.test(found))
    throw Error(`PREVIOUS_RELEASE_UNKNOWN: this commit shares no history with ${INTEGRATION}`);
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  try {
    const commit = previousRelease(
      {
        event: process.env.EVENT,
        base: process.env.BASE,
        before: process.env.BEFORE,
        ref: process.env.REF,
      },
      () =>
        execFileSync("git", ["merge-base", "HEAD", `origin/${INTEGRATION}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
    );
    process.stdout.write(`VALO_PREVIOUS_RELEASE=${commit}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }

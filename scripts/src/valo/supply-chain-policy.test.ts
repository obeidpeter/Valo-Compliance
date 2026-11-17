import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { repositoryRoot } from "./architecture-check";

const read = (path: string) => readFileSync(`${repositoryRoot}/${path}`, "utf8");

/** Names that skip the release window by policy, with any release. */
const STANDING_EXCLUSIONS = ["'@replit/*'", "stripe-replit-sync"];

test("the dependency firewall keeps its window, trust and source restrictions", () => {
  const workspace = read("pnpm-workspace.yaml");
  assert.match(workspace, /^minimumReleaseAge: 10080$/m, "seven days, in minutes");
  assert.match(workspace, /^trustPolicy: no-downgrade$/m);
  assert.match(workspace, /^blockExoticSubdeps: true$/m);
  assert.match(read(".npmrc"), /^min-release-age=7$/m, "seven days, for npm");
});

test("every release-window exemption is standing policy or one version already locked", () => {
  const workspace = read("pnpm-workspace.yaml"),
    lock = read("pnpm-lock.yaml");
  const block = /^minimumReleaseAgeExclude:\n((?:(?: {2}- .*| {2}#.*)\n)+)/m.exec(workspace);
  assert.ok(block, "the exemption list was found");
  const entries = block[1]!
    .split("\n")
    .filter((line) => line.startsWith("  - "))
    .map((line) => line.slice(4).trim());
  assert.ok(entries.length >= STANDING_EXCLUSIONS.length);
  const packages = lock.split("\npackages:\n")[1]!.split("\nsnapshots:\n")[0]!;
  for (const entry of entries) {
    if (STANDING_EXCLUSIONS.includes(entry)) continue;
    // A temporary exemption names one exact version, which must be the one already locked,
    // so it can only re-admit what the lockfile holds.
    const exact = /^'?((?:@[a-z0-9-]+\/)?[a-z0-9.-]+)@(\d+\.\d+\.\d+)'?$/.exec(entry);
    assert.ok(exact, `${entry} must name one exact version`);
    assert.ok(
      new RegExp(
        `^  '?${exact[1]!.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}@${exact[2]!.replace(/\./g, "\\.")}'?:`,
        "m",
      ).test(packages),
      `${entry} is not in the lockfile`,
    );
  }
});

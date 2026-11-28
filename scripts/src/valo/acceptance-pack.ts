import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readiness, requirements } from "@workspace/valo-records";
import {
  citationResult,
  readCitations,
  readTestRecords,
  type Citation,
  type CitationResult,
  type TestRecord,
} from "./ci-evidence";

/**
 * The acceptance pack (docs/architecture/acceptance-pack.md): for each of the specification's ten
 * user-test packs, the evidence it requires, part by part, as a script in CI gives it today, as a
 * script could but none does yet, or as only the owner or another person can give it; and, for
 * each part a script gives, the cited tests and their results in this run.
 *
 * It accepts nothing. A pack is accepted only on all of its evidence and the owner's approval; a
 * script's results are at most part of that evidence, and a citation never accepts a requirement.
 */

/** Who can give a part of a pack's required evidence. */
export type GivenBy =
  /** A script in CI gives it today, in the tests cited for the requirements named. */
  | "script"
  /** A script could give it, but none does yet. */
  | "not_scripted"
  /** Only the owner can: a credential, an approval, a provider, money or a decision. */
  | "owner"
  /** Only another person can: a tester, a reviewer or the person on call. */
  | "person";

export type EvidencePart = {
  /** The words of the pack's required evidence this part covers, exactly as the specification has them. */
  text: string;
  by: GivenBy;
  /** What gives it, or what is missing. */
  how: string;
  /** For a part a script gives: the requirements whose cited tests give it. */
  requirements?: readonly string[];
};

/**
 * Each pack's required evidence, placed part by part. The parts, joined with spaces, are the
 * specification's words exactly; the test checks it. This placing is a reading of what each part
 * asks for, for the owner to check, not an acceptance.
 */
export const evidenceParts: Readonly<Record<string, readonly EvidencePart[]>> = {
  "UAT-01": [
    {
      text: "Recorded mobile/desktop journey;",
      by: "not_scripted",
      how: "A recording of the journey on a phone and on a desktop. The browser rehearsal of a business owner's first tasks runs a journey like it, unrecorded.",
    },
    {
      text: "correct output and stored revision.",
      by: "script",
      how: "The tests of real files, owned downloads and saved revisions.",
      requirements: ["EDT-006", "DOC-005", "EDT-004"],
    },
  ],
  "UAT-02": [
    {
      text: "Sandbox tests",
      by: "owner",
      how: "A run against Paystack's test mode, which needs the owner's test key. The cited payment tests stand in for Paystack.",
    },
    {
      text: "plus authorised low-value live purchase/refund before public launch.",
      by: "owner",
      how: "A live purchase and refund, which only the owner can authorise.",
    },
  ],
  "UAT-03": [
    {
      text: "Golden sample comparison,",
      by: "not_scripted",
      how: "A comparison with kept golden samples. Each guided template's Word file is compared with its page, not with a kept sample.",
    },
    {
      text: "Word/PDF opening",
      by: "script",
      how: "The tests that open each file in a second program.",
      requirements: ["EDT-006"],
    },
    {
      text: "and revision-conflict tests.",
      by: "script",
      how: "The tests of saving and of two tabs changing one document.",
      requirements: ["EDT-004"],
    },
  ],
  "UAT-04": [
    {
      text: "60-case rubric; ≥95% pass; zero critical leakage or invented legal claims.",
      by: "owner",
      how: "Real model runs of the 60 customer AI cases. They need the customer AI path, off until the owner records a daily allowance, and an approved AI budget.",
    },
  ],
  "UAT-05": [
    {
      text: "80-scenario expected-output suite;",
      by: "script",
      how: "The run of the 80 frozen scenarios through the live check.",
      requirements: ["RUL-008"],
    },
    {
      text: "all critical decisions and exclusions pass.",
      by: "script",
      how: "The same run's result for each scenario.",
      requirements: ["RUL-008"],
    },
  ],
  "UAT-06": [
    {
      text: "Negative test matrix across every private entity and action.",
      by: "script",
      how: "The cross-workspace tests of every private route and entity.",
      requirements: ["SEC-001", "IAM-003"],
    },
  ],
  "UAT-07": [
    {
      text: "Separate editorial suite of 60 cases;",
      by: "person",
      how: "The 60 editorial cases run through real reviews, judged by the independent reviewer the owner appoints (decision 0016).",
    },
    {
      text: "zero critical false releases;",
      by: "script",
      how: "The tests that a candidate failing its gates stays held on every publication path.",
      requirements: ["EDP-006", "EDP-012"],
    },
    {
      text: "immutable AI/publisher evidence and visible disclosure.",
      by: "script",
      how: "The tests of the publication manifest and of what the site shows of a release.",
      requirements: ["EDP-007", "EDP-008"],
    },
  ],
  "UAT-08": [
    {
      text: "Restore drill,",
      by: "not_scripted",
      how: "An end-to-end restore drill that asserts the recovery point and time: the finishing plan's backup row.",
    },
    {
      text: "reconciliation result,",
      by: "owner",
      how: "A reconciliation against Paystack's test mode, which needs the owner's test merchant. The cited reconciliation tests stand in for Paystack.",
    },
    {
      text: "load report",
      by: "script",
      how: "The measured load runs in the database job.",
      requirements: ["NFR-003", "NFR-004"],
    },
    {
      text: "and on-call drill.",
      by: "person",
      how: "A drill with the person on call.",
    },
  ],
  "UAT-09": [
    {
      text: "Verified processor checklist",
      by: "owner",
      how: "The owner's verification of the processor review, which is a draft.",
    },
    {
      text: "and end-to-end data-lifecycle test.",
      by: "script",
      how: "The tests of a privacy request from the request to erasure.",
      requirements: ["PRV-003"],
    },
  ],
  "UAT-10": [
    {
      text: "Delivered test email,",
      by: "owner",
      how: "A message delivered by a real email provider, which the owner chooses. The cited message tests use a stand-in sender.",
    },
    {
      text: "support ticket, preference and retry records.",
      by: "script",
      how: "The tests of enquiries, delivery preferences and the messages' retries.",
      requirements: ["SRV-002", "WRK-004", "WRK-003"],
    },
  ],
};

/**
 * The requirements a pack's reference names: the words before its colon, as families ("WEB, DOC"),
 * ranges ("PAY-001–009") or both ("ADM + EDP-001–012"). A token that names no requirement is refused.
 */
export function packRequirementIds(reference: string, ids: readonly string[]) {
  const head = reference.split(":")[0] ?? "";
  const found = new Set<string>();
  for (const token of head
    .split(/[,+]/)
    .map((t) => t.trim())
    .filter(Boolean)) {
    const range = /^([A-Z]+)-(\d{3})–(\d{3})$/.exec(token);
    const family = /^([A-Z]+)$/.exec(token);
    const matched = range
      ? ids.filter((id) => {
          const [prefix, number] = id.split("-");
          return (
            prefix === range[1] && Number(number) >= Number(range[2]) && Number(number) <= Number(range[3])
          );
        })
      : family
        ? ids.filter((id) => id.startsWith(`${family[1]}-`))
        : [];
    if (!matched.length) throw Error(`ACCEPTANCE_PACK_REFERENCE_UNKNOWN:${token}`);
    for (const id of matched) found.add(id);
  }
  return [...found];
}

type Counted = { cited: number; pass: number; fail: number; notRun: number; problems: string[] };

function count(citations: readonly Citation[], records: TestRecord[] | undefined): Counted {
  const results = citations.map((c) => ({
    c,
    result: (records ? citationResult(c, records) : "not_run") as CitationResult,
  }));
  return {
    cited: results.length,
    pass: results.filter((r) => r.result === "pass").length,
    fail: results.filter((r) => r.result === "fail").length,
    notRun: results.filter((r) => r.result === "not_run").length,
    problems: results
      .filter((r) => r.result !== "pass")
      .map((r) => `${r.c.requirement} "${r.c.test}" (${r.c.file}) ${r.result}`),
  };
}

/** The acceptance pack for the citations and, when given, one run's test records. */
export function acceptancePack(citations: readonly Citation[], records: TestRecord[] | undefined) {
  const ids = requirements.map((r) => r.id);
  return {
    accepts: false as const,
    resultsFromThisRun: records !== undefined,
    packs: readiness().uatPackages.map((pack) => {
      const covered = packRequirementIds(pack.requirements, ids);
      const parts = evidenceParts[pack.id];
      if (!parts) throw Error(`ACCEPTANCE_PACK_PARTS_MISSING:${pack.id}`);
      return {
        id: pack.id,
        title: pack.title,
        requirements: pack.requirements,
        requiredEvidence: pack.requiredEvidence,
        accepted: false as const,
        requirementIds: covered,
        citedTests: count(
          citations.filter((c) => covered.includes(c.requirement)),
          records,
        ),
        parts: parts.map((part) => ({
          ...part,
          ...(part.requirements
            ? {
                tests: count(
                  citations.filter((c) => part.requirements!.includes(c.requirement)),
                  records,
                ),
              }
            : {}),
        })),
      };
    }),
  };
}

const said: Record<GivenBy, string> = {
  script: "a script gives it",
  not_scripted: "not yet scripted",
  owner: "the owner",
  person: "a person",
};

/** The pack as a short table for a run's summary. */
export function acceptanceSummary(pack: ReturnType<typeof acceptancePack>) {
  const rows = pack.packs.flatMap((p) =>
    p.parts.map(
      (part) =>
        `| ${p.id} | ${part.text} | ${said[part.by]} | ${"tests" in part && part.tests ? `${part.tests.pass} of ${part.tests.cited} passed` : ""} |`,
    ),
  );
  return [
    "## The acceptance pack from this run",
    "",
    "Nothing here accepts a pack: each needs all of its evidence and the owner's approval.",
    "",
    "| Pack | Required evidence | Given by | Cited tests |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function main() {
  const directory = process.env.VALO_EVIDENCE_RESULTS_DIR;
  const pack = acceptancePack(readCitations(), directory ? readTestRecords(directory) : undefined);
  const out = process.argv[2];
  const json = JSON.stringify(pack, null, 2) + "\n";
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, acceptanceSummary(pack));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

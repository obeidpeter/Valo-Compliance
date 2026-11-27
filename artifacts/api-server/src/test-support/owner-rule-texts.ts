import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allSourceLeads, sha256 } from "@workspace/valo-core";

/**
 * Copies of the official texts of the four rules prepared in the repository (decision 0020) that hold
 * their passages: the words of the Acts as the research notes kept them. The guides cut the data
 * protection Act's passages from a capture by their opening and closing words and checksums, so a
 * copy that holds these words holds exactly those passages. Each copy is dated an hour before `now`:
 * a day after the latest search the amendment records describe, so the copies hold when the records
 * are refreshed, and no earlier than midday on `scenarioDate`, which the checker will not assess ahead
 * of. In memory: nothing is read from storage, released or reviewed.
 */
export async function ownerRuleTextCopies(scenarioDate: string) {
  // Loaded here, not on import, so a test can set its database address first.
  const { guideAmendmentRecords, retainedGuidePassages } = await import("../modules/publication");
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const ndpaResearch = JSON.parse(
    readFileSync(`${root}docs/content-candidates/source-evidence/ndpa-captured-passages.json`, "utf8"),
  ) as { passages: { id: string; exactText: string }[] };
  const ndpaWords = ndpaResearch.passages.map((p) => p.exactText).join("\n");
  const retained = retainedGuidePassages();
  const camaWords = ["CAMA-814"].map((id) => retained(id)!.text).join("\n");
  const ntaaWords = ["NTAA-11", "NTAA-147-DEFINITIONS"].map((id) => retained(id)!.text).join("\n");
  const f33Words = ["NAFDAC-F33-PAGE-2", "NAFDAC-F33-PAGE-7"].map((id) => retained(id)!.text).join("\n\f");
  const record = (instrument: string) => guideAmendmentRecords.find((r) => r.instrument === instrument)!;
  const records = [
    record("CAC-CAMA-2020"),
    record("NDPC-NDPA-2023"),
    record("NASS-NTAA-2025"),
    record("NAFDAC-CAP-F33"),
  ];
  const latest = Math.max(...records.flatMap((r) => r.searches.map((s) => Date.parse(s.searchedAt))));
  const now = new Date(Math.max(latest + 86_400_000, Date.parse(`${scenarioDate}T12:00:00Z`)));
  const checkedAt = new Date(+now - 3_600_000).toISOString();
  const copy = (leadId: string, text: string, rawChecksum: string, n: number) => ({
    leadId,
    url: allSourceLeads.find((l) => l.id === leadId)!.url,
    snapshotId: `00000000-0000-4000-8000-00000000000${n}`,
    checkedAt,
    rawChecksum,
    textChecksum: sha256(text),
    text,
  });
  const captures = [
    copy("SV-010", `Front matter. ${camaWords} More text.`, record("CAC-CAMA-2020").rawSha256, 1),
    copy("S04", `Front matter.\n${ndpaWords}\nMore text.`, record("NDPC-NDPA-2023").rawSha256, 2),
    copy("NASS-NTAA-2025", `Front matter. ${ntaaWords} More text.`, record("NASS-NTAA-2025").rawSha256, 3),
    copy("NAFDAC-CAP-F33", `Front matter.\f${f33Words}\fMore text.`, record("NAFDAC-CAP-F33").rawSha256, 4),
  ];
  return { now, captures };
}

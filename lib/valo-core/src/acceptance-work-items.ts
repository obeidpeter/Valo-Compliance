const repo = "https://github.com/obeidpeter/Valo-Compliance/issues/";
export const acceptanceWorkItems = [
  {
    number: 3,
    title: "Checker, tasks and four customer AI workflows",
    release: "R1",
    prefixes: ["RUL", "AI", "CMP", "PRO", "WRK"],
    ids: [],
  },
  {
    number: 4,
    title: "Eligible editorial publication and usable content",
    release: "R1",
    prefixes: ["EDP", "DOC", "CMP"],
    ids: ["ADM-002", "ADM-003", "ADM-004", "ADM-005", "RUL-004", "RUL-008"],
  },
  {
    number: 5,
    title: "Sandbox commerce and operations",
    release: "R1",
    prefixes: ["PAY"],
    ids: [
      "ADM-001",
      "ADM-006",
      "ADM-007",
      "ADM-008",
      "ADM-009",
      "WRK-003",
      "WRK-004",
      "WRK-006",
      "PRV-003",
      "SRV-001",
      "SRV-002",
      "SRV-003",
    ],
  },
  {
    number: 6,
    title: "Security, recovery and customer journey corrections",
    release: "R1",
    prefixes: ["SEC", "NFR", "OPS", "IAM", "EDT", "WEB"],
    ids: ["DOC-002", "DOC-003", "DOC-004", "DOC-005", "CMP-009", "WRK-006", "PRV-003"],
  },
  {
    number: 7,
    title: "Gated R2 growth",
    release: "R2",
    prefixes: ["IAM", "PRO", "DOC", "EDT", "AI", "WRK", "SRV", "PAY"],
    ids: [],
  },
] as const;
export function workItemsForRequirement(id: string) {
  return acceptanceWorkItems
    .filter(
      (item) =>
        (item.prefixes as readonly string[]).includes(id.split("-")[0]!) ||
        (item.ids as readonly string[]).includes(id),
    )
    .map((item) => ({
      url: repo + item.number,
      title: item.title,
      release: item.release,
      relation:
        item.release === "R2" ? "gated_future_extension_not_R1_acceptance" : "implementation_and_review",
      status: "external_tracking_not_release_acceptance",
    }));
}

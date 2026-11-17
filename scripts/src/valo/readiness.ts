import { readiness, baselineTemplates, additionalCandidates, catalogueSummary } from "@workspace/valo-core";

process.stdout.write(
  JSON.stringify(
    {
      ...readiness(),
      catalogueSummary,
      baselineTemplates,
      additionalCandidates,
    },
    null,
    2,
  ) + "\n",
);

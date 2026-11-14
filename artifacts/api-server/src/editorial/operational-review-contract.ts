import { z } from "zod";
export const operationalReviewSchema=z.object({
  verdict:z.enum(["pass","hold"]),findings:z.array(z.string()),missingEvidence:z.array(z.string()),
  observations:z.array(z.string()),
}).strict();

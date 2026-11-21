import { z } from "zod";
export const originalFormSchema = z
  .object({
    purpose: z.string(),
    registerInstructions: z.string(),
    itemInstructions: z.string(),
    movementInstructions: z.string(),
    countInstructions: z.string(),
  })
  .strict();
export type OriginalForm = z.infer<typeof originalFormSchema>;
export function formMarkdown(o: OriginalForm) {
  const sections = [
    [
      "Register details",
      o.registerInstructions,
      [
        "Business name",
        "Register reference",
        "Stock location",
        "Maintainer",
        "Last updated (date/time/timezone)",
      ],
    ],
    [
      "Item record",
      o.itemInstructions,
      [
        "Item code",
        "Item description",
        "Unit of measure",
        "Location/bin",
        "Batch/lot (optional)",
        "Opening quantity",
        "Opening date",
        "Opening quantity basis",
      ],
    ],
    [
      "Stock movement",
      o.movementInstructions,
      [
        "Movement date/time",
        "Movement reference",
        "Movement description",
        "Received quantity",
        "Issued quantity",
        "Adjustment (+ or -)",
        "Adjustment reason",
        "Running quantity (entered by user)",
        "Related record",
        "Recorded by",
      ],
    ],
    [
      "Physical count",
      o.countInstructions,
      [
        "Count date/time",
        "Counted by",
        "Expected quantity",
        "Actual quantity",
        "Difference (entered by user)",
        "Explanation or not yet known",
        "Follow-up action",
        "Responsible person",
        "User-chosen target date",
        "Open/investigating/resolved status",
      ],
    ],
  ] as const;
  return (
    `Purpose: ${o.purpose}\n\n` +
    sections
      .map(
        ([title, text, fields]) =>
          `### ${title}\n\n${text}\n\n| Field | Your information |\n|---|---|\n${fields.map((f) => `| ${f} | [ ] |`).join("\n")}`,
      )
      .join("\n\n")
  );
}

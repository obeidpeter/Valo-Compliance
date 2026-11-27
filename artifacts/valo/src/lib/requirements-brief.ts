import type { AssessmentResult } from "@workspace/api-client-react";
import { displayFact, factLabel, reviewFacts } from "./checker";
import { formatDateTime, formatDay } from "./format";
import {
  requirementDates,
  requirementFigures,
  requirementRoute,
  resultGaps,
  shortRulesVersion,
} from "./result-words";
import { RESULT_LABELS } from "./rich-checker";

/**
 * Formats a requirements check result and the answers behind it as a clean plain-text brief
 * suitable for pasting into WhatsApp or email when consulting an accountant, lawyer, or co-founder.
 */
export function formatRequirementsBrief(input: {
  result: AssessmentResult;
  facts: Record<string, unknown>;
  savedAt?: string | undefined;
  profileRevision?: number | null | undefined;
}): string {
  const { result, facts, savedAt, profileRevision } = input;
  const lines: string[] = [
    "VALO — BUSINESS REQUIREMENTS SUMMARY",
    "Not legal, tax or accounting advice, and no regulator endorses this summary. Confirm important obligations with the authority or a qualified adviser.",
    "",
    `Rules as at: ${formatDay(result.asOfDate)}`,
    `Rules version: ${shortRulesVersion(result.rulesetVersion)}`,
    `Reference: ${result.resultHash.slice(0, 12)}`,
  ];

  if (savedAt) {
    lines.push(`Saved: ${formatDateTime(savedAt)}`);
  }
  if (profileRevision) {
    lines.push(`Source: Business profile (version ${profileRevision})`);
  }

  lines.push("", "RESULTS");
  if (result.items.length === 0) {
    lines.push("- No published rule covers these answers yet. This does not mean you are exempt.");
  } else {
    const labels = [
      ...RESULT_LABELS,
      ...new Set(
        result.items
          .map((item) => item.label)
          .filter((label) => !(RESULT_LABELS as readonly string[]).includes(label)),
      ),
    ];
    for (const label of labels) {
      const group = result.items.filter((item) => item.label === label);
      if (!group.length) continue;
      lines.push("", `[${label} — ${group.length}]`);
      for (const item of group) {
        const place =
          item.jurisdiction.level === "federal"
            ? "Federal"
            : item.jurisdiction.level === "state"
              ? ["State", item.jurisdiction.state].filter(Boolean).join(": ")
              : [
                  "Local government",
                  [item.jurisdiction.lga, item.jurisdiction.state].filter(Boolean).join(", "),
                ]
                  .filter(Boolean)
                  .join(": ");
        lines.push(`- ${item.title} (${place}, Rule ${item.ruleId} v${item.ruleVersion})`);
        if (item.releaseNotice) lines.push(`  About this rule: ${item.releaseNotice}`);
        const dates = requirementDates(item);
        if (dates.length) lines.push(`  Dates: ${dates.join("; ")}`);
        lines.push(`  Why: ${item.reason}`);
        if (item.nextStep) lines.push(`  Next step: ${item.nextStep}`);
        const route = requirementRoute(item);
        if (route) lines.push(`  Official page: ${route.authority} (${route.url})`);
        for (const figure of requirementFigures(item))
          lines.push(`  ${figure.label}: ${figure.words}${figure.source ? ` (${figure.source})` : ""}`);
        if (item.sources.length > 0) {
          lines.push(`  Sources: ${item.sources.map((s) => `${s.title} (${s.url})`).join("; ")}`);
        }
      }
    }
  }

  const reviewed = reviewFacts(facts);
  if (reviewed.length > 0) {
    lines.push("", "ANSWERS USED");
    for (const [key, value] of reviewed) {
      lines.push(`- ${factLabel(key)}: ${displayFact(key, value)}`);
    }
  }

  const gaps = resultGaps(result.gaps, result.items.length === 0);
  if (gaps.length > 0) {
    lines.push("", "WHAT VALO DOES NOT COVER YET");
    for (const gap of gaps) {
      lines.push(`- ${gap}`);
    }
  }

  if (result.officialRoutes.length > 0) {
    lines.push("", "OFFICIAL SOURCES");
    for (const route of result.officialRoutes) {
      lines.push(`- ${route.title}: ${route.url}`);
    }
  }

  return lines.join("\n");
}

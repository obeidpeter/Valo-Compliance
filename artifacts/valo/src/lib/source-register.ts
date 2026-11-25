import { formatCount, formatDateTime, formatDay } from "./format";

/**
 * The staff Content area's words for the source register (docs/architecture/source-register.md,
 * slice 1): each official source as staff keep it. The words are the owner's to confirm.
 */
export const registerHeading = "Official sources";
export const registerIntro =
  "Each official source Valo reads, as staff keep it: who issues it, where it applies, what kind of text it is, the version in force and the day it took effect. A correction is a new version with why; no version is ever changed or removed.";
export const instrumentNames = {
  act: "Act",
  regulatory_document: "Regulator's document",
  official_page: "Official page",
} as const;
export const notKnown = "Not recorded yet";

export function registerSummary(entries: number, unfiled: number) {
  const filed = `${formatCount(entries)} ${entries === 1 ? "source" : "sources"} in the register`;
  return unfiled ? `${filed} · ${formatCount(unfiled)} kept in the repository not filed yet` : filed;
}
export function fileButton(unfiled: number) {
  return `File the ${formatCount(unfiled)} ${unfiled === 1 ? "source" : "sources"} kept in the repository`;
}

/** What an entry's daily check last did and when it runs next, that it stopped when the source was
 * retired, or that nothing watches it. */
export function watchLine(
  watch: {
    checkedAt: string | null;
    failureCode: string | null;
    nextCheckAt: string | null;
    stoppedAt: string | null;
  } | null,
) {
  if (!watch) return "Not watched by the daily check";
  if (watch.stoppedAt)
    return `The daily check stopped ${formatDateTime(watch.stoppedAt)}, when the source was retired`;
  const last = watch.failureCode
    ? `The daily check could not read it (${watch.failureCode})`
    : watch.checkedAt
      ? `Checked by the daily check ${formatDateTime(watch.checkedAt)}`
      : "Watched; waiting for its first check";
  return watch.nextCheckAt ? `${last} · next check ${formatDateTime(watch.nextCheckAt)}` : last;
}

/** An entry's fields as one line: where it applies, what kind of text, the version and its day. */
export function entryLine(entry: {
  jurisdiction: string;
  instrument: keyof typeof instrumentNames | null;
  versionInForce: string | null;
  effectiveFrom: string | null;
}) {
  return [
    entry.jurisdiction,
    entry.instrument ? instrumentNames[entry.instrument] : null,
    entry.versionInForce,
    entry.effectiveFrom ? `in effect from ${formatDay(entry.effectiveFrom + "T12:00:00+01:00")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** An earlier version, as the entry's history lists it. */
export function versionLine(version: { version: number; createdAt: string; reason: string }) {
  return `Version ${formatCount(version.version)}, ${formatDay(version.createdAt)}: ${version.reason}`;
}

export const reasonLabel = "Why";
export const reasonHint = "Say what you checked and why the entry changes, in 20 to 1,000 characters.";
export const retiredNote =
  "Retired. The daily check no longer reads it, and what rested on it is held until a new version passes the gates. Its versions stay on the record.";

/** How many versions rest on a source: bound to it and not held yet. */
export function restingLine(resting: number) {
  return `${formatCount(resting)} ${resting === 1 ? "version rests" : "versions rest"} on it`;
}
/** What retiring a source does, said before it is saved. */
export function retireWarning(resting: number) {
  return resting
    ? `Retiring it stops its daily check and holds the ${formatCount(resting)} ${resting === 1 ? "version that rests" : "versions that rest"} on it, until a new version of each passes the gates.`
    : "Retiring it stops its daily check. Nothing rests on it, so nothing is held.";
}

/** Adding a source staff name (docs/architecture/source-register.md, slice 2). */
export const addHeading = "Add an official source";
export const addButton = "Add it to the register";
export const watchNowLabel = "Start its daily check now";
export const addedByStaff = "Added by staff";
/** Where a source may be added: the hosts the approved guidance policy lists. */
export function hostsHint(hosts: readonly string[]) {
  return `An https address on one of the hosts the guidance policy lists: ${hosts.join(", ")}.`;
}
export function addedMessage(title: string, sourceId: string) {
  return `Added ${title} to the register as ${sourceId}.`;
}

import { sha256 } from "@workspace/valo-core";
import { guideAmendmentRecords, type AmendmentRecord } from "./guidance-amendments";
import type { GuideClaimScope } from "./guidance-bundle";
import type { GuideRightsRecord } from "./guidance-rights";

/**
 * What a guide's two reviewers are given beside the candidate, its sources and its files' report.
 *
 * A review request has a size limit, so nothing is sent twice and nothing is sent that a reviewer
 * cannot use:
 *
 * - The retained draft is not sent a second time. The candidate's body already holds its words, and
 *   the server confirms that before any request is made. Its checksum is sent.
 * - An amendment record is sent as it bears on the sections the guide quotes: every place searched
 *   and what was found there, every amending instrument with the numbers of all the sections it
 *   changes and its own words on the sections quoted, every comparison and difference touching
 *   them, every open question about the text whatever section it names, anything not yet read, and
 *   the record's limits in full. Left out are checksums and capture times, and an amending
 *   instrument's words on sections the guide does not quote; the record in the repository holds
 *   them.
 */

type Passages = GuideClaimScope["passages"];

/** For each Act or directive a guide quotes, what its amendment record holds about what is quoted. */
export function guideAmendmentBasis(
  passages: Passages,
  records: readonly AmendmentRecord[] = guideAmendmentRecords,
) {
  const quotedBy = new Map<string, Set<string>>();
  for (const passage of passages) {
    const sections = quotedBy.get(passage.instrument.id) ?? new Set<string>();
    for (const section of passage.sections) sections.add(section);
    quotedBy.set(passage.instrument.id, sections);
  }
  return records
    .filter((record) => quotedBy.has(record.instrument))
    .map((record) => {
      const quoted = quotedBy.get(record.instrument)!;
      const ofQuoted = <T>(bySection: Record<string, T>) =>
        Object.fromEntries(Object.entries(bySection).filter(([section]) => quoted.has(section)));
      return {
        text: record.title,
        url: record.url,
        commencement: {
          asThisCopyPrintsIt: record.commencement.printed,
          treatedAsInForceFrom: record.commencement.effectiveFrom,
        },
        sectionsQuoted: [...quoted].sort((a, b) => Number(a) - Number(b)),
        searched: record.searches.map((search) => ({
          place: search.place,
          url: search.url,
          on: search.searchedAt.slice(0, 10),
          found: search.found,
        })),
        amendingInstruments: record.amendments.map((amending) => ({
          title: amending.title,
          url: amending.url,
          commencement: amending.commencement,
          sectionsItChanges: Object.keys(amending.sections),
          onSectionsQuoted: ofQuoted(amending.sections),
        })),
        notRead: record.notRead,
        ...(record.comparedSections ? { copiesCompared: ofQuoted(record.comparedSections) } : {}),
        differencesAndOpenQuestions: record.conflicts.filter(
          (conflict) =>
            conflict.open || conflict.sections === "all" || conflict.sections.some((s) => quoted.has(s)),
        ),
        limits: record.limits,
      };
    });
}

/** The rights and provenance parts of a guide's review request. */
export function guideReviewInputs(input: {
  provenance: {
    path: string;
    hash: string;
    note: string;
    noteHash: string;
    authoringRoute: string;
    transformation: string;
  };
  /** The retained draft's words, which the candidate's body was built from. */
  originalText: string;
  /** The body built again from those words just now, and the body the candidate holds. */
  rebuiltBody: string;
  candidateBody: string;
  rights: Pick<GuideRightsRecord, "permissions" | "conclusion" | "officialText">;
  /** The provider-permission record without its evidence, which the permissions already carry. */
  permissionScope: unknown;
  claimScope: Pick<GuideClaimScope, "sentences" | "byKind" | "passages">;
  amendmentRecords?: readonly AmendmentRecord[];
}) {
  // The draft is not sent, so the statement below must be true of this very candidate.
  if (input.rebuiltBody !== input.candidateBody) throw Error("SAVED_BODY_NOT_EXACT_CURRENT_INTAKE");
  const { measured, ...officialText } = input.rights.officialText;
  return {
    rightsInput: {
      permissions: input.rights.permissions,
      conclusion: input.rights.conclusion,
      customerLicenceAccepted: false,
      providerPermissionScope: input.permissionScope,
      // The measure of wording repeated from each passage; the sources carry their own checksums.
      officialText: {
        ...officialText,
        measured: measured.map(({ sourceId, sharedWords }) => ({ sourceId, sharedWords })),
      },
    },
    provenanceInput: {
      authoringRoute: input.provenance.authoringRoute,
      sourceHash: input.provenance.hash,
      sourcePath: input.provenance.path,
      originalItemSha256: sha256(input.originalText),
      originalItem:
        "Not sent again: the candidate's body holds its words, which the server confirmed before making this request.",
      actualAuthoringAttribution:
        (JSON.parse(input.provenance.note) as { authoring?: unknown }).authoring ?? null,
      authoringNoteHash: input.provenance.noteHash,
      adaptation: input.provenance.transformation,
      upstreamModelAndRunNotRecorded: true,
      // What the reviewers check the claims and the amendment checks against.
      claimScope: { sentences: input.claimScope.sentences, byKind: input.claimScope.byKind },
      amendmentBasis: guideAmendmentBasis(input.claimScope.passages, input.amendmentRecords),
    },
  };
}

import type {
  PrivacyCaseDetailEventsItemActorType,
  PrivacyCaseDetailStepsItemStatus,
  PrivacyCaseKind,
  PrivacyCaseStatus,
} from "@workspace/api-client-react";

/** A name of the system's own, spelt in words: for a value this build has no words for. */
const spelt = (name: string) => {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const said = (words: Record<string, string>, name: string) => words[name] ?? spelt(name);

/** What each kind of privacy request is called: the words the form offers it in. */
export const PRIVACY_KIND_WORDS: Record<PrivacyCaseKind, string> = {
  correction: "Correct something",
  export: "Full data request",
  deletion: "Delete my data",
};

/**
 * Where a privacy request stands. "Partly done" and "Done" are the server's own two states: it
 * calls a request done only when every system it tracks has a confirmed outcome.
 */
export const PRIVACY_STATUS_WORDS: Record<PrivacyCaseStatus, string> = {
  awaiting_verification: "Waiting for you to confirm it",
  verified: "Confirmed, waiting for staff",
  assigned: "With privacy staff",
  in_progress: "Being carried out",
  needs_information: "Staff need more information",
  held: "On hold",
  partially_fulfilled: "Partly done",
  fulfilled: "Done",
  rejected: "Refused",
  cancelled: "Cancelled",
  failed: "Failed",
};

/** The places a request is carried out in, one step each. */
const STEP_WORDS: Record<string, string> = {
  identity_verification: "Confirming it is you",
  application: "Your Valo workspace",
  private_files: "Your files",
  managed_identity: "Your sign-in account",
  external_processors: "Other services Valo uses",
  retention_and_recovery: "Records Valo must keep, and backups",
};

/** How far one step has got. */
export const PRIVACY_STEP_STATUS_WORDS: Record<PrivacyCaseDetailStepsItemStatus, string> = {
  pending: "Not started",
  running: "In progress",
  confirmed: "Confirmed",
  held: "On hold",
  failed: "Failed",
  not_applicable: "Not needed",
};

/** Who did something to a request. */
const ACTOR_WORDS: Record<PrivacyCaseDetailEventsItemActorType, string> = {
  customer: "You",
  staff: "Valo staff",
  worker: "Valo's system",
};

export const privacyKindWords = (kind: string) => said(PRIVACY_KIND_WORDS, kind);
export const privacyStatusWords = (status: string) => said(PRIVACY_STATUS_WORDS, status);
export const privacyStepWords = (system: string) => said(STEP_WORDS, system);
export const privacyStepStatusWords = (status: string) => said(PRIVACY_STEP_STATUS_WORDS, status);
export const privacyActorWords = (actor: string) => said(ACTOR_WORDS, actor);
/** What was done, as the server names it, spelt in words. */
export const privacyActionWords = (action: string) => spelt(action);

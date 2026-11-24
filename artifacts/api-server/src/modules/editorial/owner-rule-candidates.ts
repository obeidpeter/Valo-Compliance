import type { OwnerRuleBundle, PublicationBundle, ReleasedRule } from "@workspace/valo-core";

/** A requirements-checker rule prepared in the repository for the owner's sign-off (decision 0020). */
export type OwnerRuleCandidate = {
  rule: Pick<
    ReleasedRule,
    | "id"
    | "requirementVersionId"
    | "title"
    | "jurisdiction"
    | "validFrom"
    | "validTo"
    | "reason"
    | "nextStep"
    | "relatedTemplateIds"
  > &
    Partial<Pick<ReleasedRule, "condition" | "evaluator">>;
  risk: PublicationBundle["candidate"]["risk"];
  scope: string;
  limitations: string;
  assumptions: string[];
  /** Anything recorded here holds the whole rule (EDP-005). */
  unresolvedMaterialIssues: string[];
  missingEvidence: string[];
  sources: {
    id: string;
    /** A passage the guides use; its words, place and official text come from today's capture. */
    passageId: string;
    /** The registered official source that capture is of. */
    leadId: string;
    /** Where the quote is, as the customer sees it ("section 814(1)"). */
    locator: string;
    /** The words of the passage the rule shows the customer. */
    quote: string;
  }[];
  claims: PublicationBundle["candidate"]["claims"];
  rights: PublicationBundle["rights"];
  scenarios: OwnerRuleBundle["scenarios"];
};

/** The rules prepared for the owner's sign-off. None is prepared yet: the first come from decision
 * 0020's research notes. */
export const ownerRuleCandidates: OwnerRuleCandidate[] = [];

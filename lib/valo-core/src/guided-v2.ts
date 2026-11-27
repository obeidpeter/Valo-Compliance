import type { GuidedField, GuidedSpec, GuidedTable, GuidedTemplateId } from "./guided";

/**
 * The second version of the fill-in forms (docs/architecture/forms-v2.md). A v2 form fills the
 * wording of one released edition of its template, held as form text (`form-text.ts`), instead of
 * printing each question with its answer. The questions v2 keeps are v1's, in v1's words (the
 * finishing plan's delegated decision 1), taken from `GUIDED_SPECS_V1` by reference; these types
 * add only what joining a question to the template's wording needs.
 */
export type GuidedFieldV2 = GuidedField & {
  /** The slots of the form text this question fills. Several questions may fill one slot. */
  tokens?: readonly string[];
  /** A choice between passages of the template's own text: its options keep spans of it. */
  clause?: true;
  /** A hint shown under the question. It is never saved or printed. */
  example?: string;
};
export type GuidedTableV2 = Omit<GuidedTable, "columns"> & {
  columns: GuidedFieldV2[];
};
export type GuidedSpecV2 = {
  schemaVersion: 2;
  templateId: GuidedTemplateId;
  title: string;
  fields: readonly GuidedFieldV2[];
  tables: readonly GuidedTableV2[];
  /** Slots left for completion by hand, such as signatures: never filled, never invented. */
  blanks: readonly string[];
  /** Slots the form works out itself (`calc.*`), and how: from the answers and, in a repeating row or
   * group, that row's answers. Null while the answers needed are not all given and valid. */
  calculated?: Readonly<
    Record<string, (data: GuidedDataV2, row?: Readonly<Record<string, string>>) => string | null>
  >;
  /** Choice options that keep no passage of the text, each declared so that none is missed. */
  keepsNothing?: readonly { question: string; option: string }[];
  /** Choices the form works out from its answers, which keep passages as a choice's options do: a
   * payment reminder's timing paragraph, from its due date and its own date, for example. Null while
   * the answers needed are not all given and valid, when the passage kept while unanswered prints. */
  derived?: Readonly<
    Record<string, { options: readonly string[]; of: (data: GuidedDataV2) => string | null }>
  >;
  /** v1's date order checks, carried with its questions: a later date before an earlier one. */
  dateOrder?: GuidedSpec["dateOrder"];
};
export type GuidedDataV2 = {
  schemaVersion: 2;
  templateId: GuidedTemplateId;
  values: Record<string, string>;
  tables: Record<string, Record<string, string>[]>;
};
export const GUIDED_V2_PREFIX = "valo-guided-v2:";

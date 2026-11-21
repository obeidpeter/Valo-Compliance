/**
 * The fixed words of a guide's file, kept apart from the renderer so that code which only needs the
 * words does not load the renderer, and a test that replaces the renderer need not supply them.
 */

/** Printed at the top of a released guide's file and on every page of it. A guide is released in
 * development only, so the notice says so, as the template notice does. */
export const GUIDANCE_NOTICE =
  "GENERAL GUIDANCE — DEVELOPMENT RELEASE. General information, not legal advice and not a decision about your business. Check the official sources before you act.";
/** Printed instead on a sample of a draft guide, which nobody has reviewed: the sample shows the
 * layout, and the notice keeps it from being read as a released guide. */
export const GUIDANCE_DRAFT_NOTICE =
  "UNPUBLISHED DRAFT GUIDE — LAYOUT SAMPLE. This draft has not been reviewed or released. Do not rely on it.";
/** A guide's document ends with named parts ("What it covers: …"). Their blocks' ids start with this,
 * and a guide's file prints each part's name in bold. */
export const GUIDE_PART_PREFIX = "guide-";

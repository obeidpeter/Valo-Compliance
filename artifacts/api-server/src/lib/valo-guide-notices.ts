/**
 * The fixed words of a guide's file, kept apart from the renderer so that code which only needs the
 * words does not load the renderer, and a test that replaces the renderer need not supply them.
 */

export {
  GUIDANCE_DRAFT_NOTICE,
  GUIDANCE_NOTICE,
  GUIDE_PART_PREFIX,
  PRACTICAL_GUIDE_NOTICE,
} from "@workspace/valo-core/printed-page";

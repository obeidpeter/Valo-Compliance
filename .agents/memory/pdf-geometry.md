---
name: Chromium PDF geometry
description: A4 metadata rounding and reader text-order pitfalls in export validation
---
Validate A4 through a real PDF reader and a small point-based tolerance, not an exact metadata string.

**Why:** Development Chromium produced a PDF identified as A4 at 595.92 × 842.88 points, rather than the exact metric conversion. Literal dimension matching rejected a valid export.

**How to apply:** Keep strict content, checksum and revision checks. Allow only small print-rounding differences in page geometry; this does not replace manual Word/PDF accessibility and layout inspection.

PDF-reader extraction preserves page order, not canonical paragraph continuity.
Treat renderer-owned running matter separately when checking complete source
text; never waive arbitrary missing text.

**Why:** A valid paragraph spanning pages can be interrupted by separately
generated headers and footers in the reader's extracted text. Literal whole-block
matching can therefore produce false holds even when every source word exists.

**How to apply:** Retain field/disclosure completeness, geometry and checksum
checks. Record bounded, versioned reader normalization rather than relaxing
material-content requirements or rewriting historical failure evidence.

Wrapped table cells can interleave in layout-mode extraction even when raw-mode
extraction retains each cell's text. Check both content and page geometry before
classifying that as renderer loss.

**Why:** Single-reader-order checks produced false holds on valid tables;
whitespace folding also merged page-counter digits into numbered headings.

**How to apply:** Retain both reader outputs and exact content checks. Remove
only known running matter at its original line boundaries, before folding
whitespace; never strip arbitrary numbered text to force a match.

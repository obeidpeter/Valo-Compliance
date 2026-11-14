---
name: Chromium PDF geometry
description: Why automated A4 checks need a small dimensional tolerance
---
Validate A4 through a real PDF reader and a small point-based tolerance, not an exact metadata string.

**Why:** Development Chromium produced a PDF identified as A4 at 595.92 × 842.88 points, rather than the exact metric conversion. Literal dimension matching rejected a valid export.

**How to apply:** Keep strict content, checksum and revision checks. Allow only small print-rounding differences in page geometry; this does not replace manual Word/PDF accessibility and layout inspection.

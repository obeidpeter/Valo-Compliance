---
name: Customer access and product language
description: Standing customer-experience constraints from independent review
---

Account-access support must work without verified sign-in, including for suspended users, with abuse controls and no account enumeration.

Customer pages must describe working customer behavior, not operational proof or milestone terminology. Keep developer evidence separate; distinguish private own-draft exports from released catalogue masters.

**Why:** The user identified a Help dead end that demanded sign-in from people unable to sign in, and proof/status wording that displaced the product experience.

**How to apply:** Preserve an independent public help path when extending identity or support. Check real customer navigation, mobile/keyboard states and truthful feature availability whenever adding screens.

For focus fixes, account for the existing unlayered form CSS: unlayered focus resets can override layered Tailwind utilities even when the intended utility classes are present.

**Why:** A class-only focus fix did not survive the real keyboard journey; the effective CSS cascade, not class presence, determined the visible result.

**How to apply:** Verify computed focus styles with browser matchers after keyboard navigation. Keep an explicit sufficiently visible focus indicator in the same effective cascade; do not weaken the check to accept an invisible outline.

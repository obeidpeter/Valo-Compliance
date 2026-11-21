---
name: Supply-chain cooldown units
description: Why npm and pnpm use different cooldown values, and what their checks actually prove.
---

Keep the seven-day dependency release window consistent across package-manager
configuration: npm's `min-release-age` is in days; pnpm's
`minimumReleaseAge` is in minutes. pnpm remains the supported installer.

**Why:** A real repository scan found that pnpm's policy did not cover npm's
separate configuration and that a one-day pnpm window failed the selected
baseline. Official npm documentation confirms the different units. This is
development supply-chain hardening, not a new commercial or publication gate.

**How to apply:** Preserve locked installs, immutable action revisions and the
no-downgrade/exotic-transitive restrictions. An urgent patch may need a narrowly
documented exception; do not disable the firewall or globally remove the window.
A successful frozen install proves compatibility, not a negative test of every
package-manager policy. Scanner startup failures are not successful detections.

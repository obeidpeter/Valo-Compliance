# Valo Usability Evaluation Protocol

*Operational usability engineering and measurement guide for Valo Compliance, grounded in Jakob Nielsen's five usability attributes ("What Is Usability?", Chapter 1 of User Experience Re-Mastered / Usability Engineering).*

> **Status note:** This document defines Valo's repeatable usability test tasks, distribution targets, post-task satisfaction instruments, and icon comprehension gates. It is an engineering and evaluation protocol — it does **not** record completed human-participant studies or establish R1/R2 release acceptance.

---

## 1. Usability Dimensions & Non-Negotiable Boundaries

Valo evaluates **Practical Acceptability → Usefulness → Usability** across five measurable attributes, always within Valo's non-negotiable truthfulness, privacy, and security boundaries (no legal/tax advice claims, no hidden draft/AI/source disclosures, no silent fabrication of user data, and no bypassing session privacy controls):

1. **Learnability** — Time and success rate for a first-time user to reach *sufficient proficiency to do useful work* (exploratory learning: clear error messages, useful work before learning the whole app, undo/redo, confirmation before risky actions).
2. **Efficiency** — Steady-state task speed for repeat business users and Valo staff via win-win defaults, descriptive labels, and unobtrusive accelerators (`Ctrl/Cmd+S`, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `/` search focus, `?prefill=profile`).
3. **Memorability** — Returning-user performance after a casual interval (14+ days away), supported by recognition-over-recall cues on Workspace Home, recognizable saved-result context, and document-kind/status filters.
4. **Few and Noncatastrophic Errors** — Track **minor slips** (self-corrected quickly) separately from **catastrophic errors**, defined strictly as:
   - **Faulty work product** (e.g., exporting a blank/stale compliance document or misinterpreting a non-advice result), or
   - **Work destruction** (e.g., losing unsaved answers/edits on navigation, sign-out, or block deletion).
5. **Subjective Satisfaction & Peak Difficulty** — Measured *only after real task completion* (never pre-use alone), tracking both distribution targets and the single hardest episode per session (peak difficulty dominates perceived difficulty far more than total task time).

---

## 2. Participant Segments ("User Cube")

Recruit representative participants spanning all three axes of user diversity (system experience, general computer experience, and Nigerian statutory compliance domain knowledge):

| Segment | System Experience | Computer Experience | Compliance Domain Knowledge | Primary Focus |
| --- | --- | --- | --- | --- |
| **Novice SME founder / trader** | First-time (walk-up-and-use) | Low–Moderate (mobile-first) | Low | Learnability, approachability, inline SME examples |
| **Casual returning SME owner** | Intermittent (returns after ≥ 14 days) | Moderate | Low–Moderate | Memorability, Workspace Home orientation, list recognition |
| **Repeat accountant / ops manager** | Frequent user | High (desktop + keyboard) | High | Efficiency, side-by-side preview, shortcuts, comparison |
| **Valo staff operator** | High in own lane, novice in others | High | High | Safe tab switching, scannable tables, error prevention |

---

## 3. Representative Benchmark Tasks & Distribution Targets

Usability is evaluated using **full distributions** (completion rate, median, P90, and separate catastrophic error counts), not means alone.

| Task ID | Participant Segment | Task Scenario | Target Completion & Efficiency | Catastrophic Error Target |
| --- | --- | --- | --- | --- |
| **T1** | Novice SME (mobile, 360–390px) | From the landing page, complete an anonymous requirements check for a Lagos retail business, read why a rule applies, and open its official source reference. | ≥ 90% unassisted; median ≤ 3 min, P90 ≤ 5 min | **0** misread legal-advice or regulator-endorsement claims |
| **T2** | Novice SME | Carry anonymous check answers through account creation/sign-in into `/workspace/checker`, save the result, and add a due-dated task with reminders configured. | ≥ 90% unassisted; **0** forced re-entry of prior answers | **0** silently lost answers during sign-up/sign-in |
| **T3** | Novice or Repeat SME | Create a guided invoice with 2 line items, jump to a flagged item in "Still needed", verify live preview, and export Word + PDF. | ≥ 95% clean export; median ≤ 4 min | **0** accidental stale/blank exports or unapplied-amount misses |
| **T4** | Casual returning SME (≥ 14 days away) | Return to Workspace Home, spot open tasks / profile-staleness cues, find a prior invoice, and create a new draft from it ("Make another"). | ≥ 85% first-path success; median ≤ 90 s | **0** accidental overwrites of prior saved documents |
| **T5** | Repeat SME | Trigger an accidental block deletion or unsaved sign-out / navigation attempt and recover without data loss (Undo / Redo / Stay). | 100% recovery without data loss | **0** lost edits |
| **T6** | Staff Operator | Filter staff operations records, triage a support case, and verify area-switching lock clarity while edits are unsaved. | ≥ 95% unassisted | **0** accidental discarded staff edits |

---

## 4. Subjective Satisfaction Instrument (Post-Task Only)

Administer immediately **after** real task execution (pilot-test wording with 2–3 participants before running a cohort).

### A. 6-Item Likert Scale (1 = Strongly disagree … 5 = Strongly agree)

Includes reverse-polarity items (`-`) to counteract respondent politeness bias. Calibrate against the published **3.6 / 5.0** median benchmark (Nielsen & Levy, 1994), not the nominal midpoint 3.0.

1. *"It was very easy to learn how to use Valo."* (`+`)
2. *"Using Valo was a very frustrating experience."* (`-`, reverse-scored: `6 - raw`)
3. *"I feel that Valo allows me to finish my business tasks efficiently."* (`+`)
4. *"I worry that some of the things I did in Valo may have been wrong."* (`-`, reverse-scored: `6 - raw`)
5. *"Valo can do the document and requirement tasks I need."* (`+`)
6. *"Valo is pleasant to work with."* (`+`)

**Distribution gate (after reverse-scoring):**
- Mean across participants ≥ **4.0 / 5.0**
- ≥ **50%** of responses at rating **5**
- ≤ **5%** of responses at rating **1**

### B. 6 Semantic Differential Scales (1–7)

Ask participants to mark the position that best reflects their impression of Valo:
- `Pleasing` ↔ `Irritating`
- `Complete` ↔ `Incomplete`
- `Cooperative` ↔ `Uncooperative`
- `Simple` ↔ `Complicated`
- `Fast to use` ↔ `Slow to use`
- `Safe` ↔ `Unsafe`

### C. Peak-Difficulty Open Question

- *"What was the single hardest or most confusing moment in what you just tried to do?"*
- Rank recurring peak-difficulty episodes above minor speed optimizations when prioritizing UI work.

---

## 5. Icon Comprehension & Layout Ideation Gate

- Any new standalone (unlabeled) icon or toolbar symbol must pass a single-prompt comprehension test (showing command descriptions one at a time so participants cannot match by exclusion) with **≥ 66%** correct interpretation by representative SME participants (ISO 9186-2:2008 threshold).
- Any icon below 66% — or any icon representing a non-visual action (such as sign-out, save, or account settings) — must pair with a visible text label.
- Use rapid **Braindrawing** (3–6 short sketch-and-pass rounds) when exploring visual changes for dense layouts before writing code.

---

## 6. Automated Regression Guardrails

The engineering controls below run continuously in Valo's automated test suites to prevent usability regressions:

- **Unsaved work & sign-out protection:** `artifacts/valo/src/lib/use-unsaved-navigation.test.ts`
- **Anonymous-to-workspace requirements handoff & expiry:** `artifacts/valo/src/lib/checker-handoff.test.ts`, `artifacts/valo/src/lib/landing-tasks.test.ts`
- **Editor missing-field jump selectors:** `artifacts/valo/src/lib/api.test.ts`
- **Document list recognition & completeness filtering:** `artifacts/valo/src/lib/document-list-helpers.test.ts`
- **Staff operations formatting & dirty-panel lock reporting:** `artifacts/valo/src/lib/staff-table.test.ts`
- **Plain customer wording & non-advice truthfulness:** `artifacts/api-server/src/test-support/old-words.test.ts`, `scripts/src/valo/customer-wording.test.ts`
- **WCAG 2.2 AA & browser journeys (Linux CI with Chromium):** `artifacts/api-server/src/scripts/workspace-accessibility.test.ts`, `artifacts/api-server/src/scripts/public-screens-accessibility.test.ts`, `artifacts/api-server/src/scripts/primary-journeys-browser.test.ts`

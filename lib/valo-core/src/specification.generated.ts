// Generated from retained coordinating-team sources. Do not edit; run sync-specification.ts.
export const specificationSha256 = "cc1a9f021b1d5c33288a25d13fa10e9eb45f37e707fd4ae9c4c539b61dace9d1";
export const sourceRequirements = [
  {
    "id": "WEB-001",
    "title": "Equal product prominence",
    "release": "R1",
    "priority": "Must",
    "exactText": "The homepage and primary navigation must give documents and compliance guidance comparable visibility.",
    "acceptance": "both journeys are reachable within one deliberate action from the hero and mobile menu.",
    "sourceExactText": "WEB-001  Equal product prominence  [R1 · Must] The homepage and primary navigation must give documents and compliance guidance comparable visibility. Accept: both journeys are reachable within one deliberate action from the hero and mobile menu.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:119",
    "owner": "Frontend / accessibility QA",
    "dependencies": [
      "public content publication state",
      "responsive UI"
    ]
  },
  {
    "id": "WEB-002",
    "title": "Discovery and accessibility",
    "release": "R1",
    "priority": "Must",
    "exactText": "Provide library, compliance, industries, resources, services, pricing, support and legal pages; search/filter URLs must be shareable.",
    "acceptance": "keyboard, empty, loading, error and mobile states are covered for every primary route.",
    "sourceExactText": "WEB-002  Discovery and accessibility  [R1 · Must] Provide library, compliance, industries, resources, services, pricing, support and legal pages; search/filter URLs must be shareable. Accept: keyboard, empty, loading, error and mobile states are covered for every primary route.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:120",
    "owner": "Frontend / accessibility QA",
    "dependencies": [
      "public content publication state",
      "responsive UI"
    ]
  },
  {
    "id": "WEB-003",
    "title": "Public search",
    "release": "R1",
    "priority": "Must",
    "exactText": "Search approved public templates, guidance, industries, articles and service categories, with type and industry filters.",
    "acceptance": "unpublished content and customer drafts never appear; a curated 50-query relevance test meets its agreed pass threshold.",
    "sourceExactText": "WEB-003  Public search  [R1 · Must] Search approved public templates, guidance, industries, articles and service categories, with type and industry filters. Accept: unpublished content and customer drafts never appear; a curated 50-query relevance test meets its agreed pass threshold.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:121",
    "owner": "Frontend / accessibility QA",
    "dependencies": [
      "public content publication state",
      "responsive UI"
    ]
  },
  {
    "id": "WEB-004",
    "title": "Discoverability and honesty",
    "release": "R1",
    "priority": "Must",
    "exactText": "Render public content with meaningful metadata, canonical URLs and a sitemap; exclude accounts, drafts and admin pages.",
    "acceptance": "no fictional testimonials, customers, ratings or regulator endorsements are displayed in production.",
    "sourceExactText": "WEB-004  Discoverability and honesty  [R1 · Must] Render public content with meaningful metadata, canonical URLs and a sitemap; exclude accounts, drafts and admin pages. Accept: no fictional testimonials, customers, ratings or regulator endorsements are displayed in production.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:122",
    "owner": "Frontend / accessibility QA",
    "dependencies": [
      "public content publication state",
      "responsive UI"
    ]
  },
  {
    "id": "IAM-001",
    "title": "Real customer identity",
    "release": "R1",
    "priority": "Must",
    "exactText": "Use verified email-based sign-in and recovery, with optional approved social login. A Replit account must not be required.",
    "acceptance": "verification, expired-link, logout, recovery and suspended-account tests pass.",
    "sourceExactText": "IAM-001  Real customer identity  [R1 · Must] Use verified email-based sign-in and recovery, with optional approved social login. A Replit account must not be required. Accept: verification, expired-link, logout, recovery and suspended-account tests pass.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:123",
    "owner": "Identity / security QA",
    "dependencies": [
      "managed identity configuration",
      "workspace membership"
    ]
  },
  {
    "id": "IAM-002",
    "title": "Secure sessions and privileged access",
    "release": "R1",
    "priority": "Must",
    "exactText": "Use the managed identity provider’s supported session flow, secure cookies and server validation. Require MFA for staff and administrators.",
    "acceptance": "revoked sessions cannot call private endpoints; staff role changes are audited.",
    "sourceExactText": "IAM-002  Secure sessions and privileged access  [R1 · Must] Use the managed identity provider’s supported session flow, secure cookies and server validation. Require MFA for staff and administrators. Accept: revoked sessions cannot call private endpoints; staff role changes are audited.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:124",
    "owner": "Identity / security QA",
    "dependencies": [
      "managed identity configuration",
      "workspace membership"
    ]
  },
  {
    "id": "IAM-003",
    "title": "Tenant boundaries",
    "release": "R1",
    "priority": "Must",
    "exactText": "Resolve membership server-side and scope all private queries, jobs and object reads to the authorised workspace.",
    "acceptance": "changing a workspace, draft, order or file identifier cannot reveal another business’s data.",
    "sourceExactText": "IAM-003  Tenant boundaries  [R1 · Must] Resolve membership server-side and scope all private queries, jobs and object reads to the authorised workspace. Accept: changing a workspace, draft, order or file identifier cannot reveal another business’s data.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:125",
    "owner": "Identity / security QA",
    "dependencies": [
      "managed identity configuration",
      "workspace membership"
    ]
  },
  {
    "id": "PRO-001",
    "title": "Business profile",
    "release": "R1",
    "priority": "Must",
    "exactText": "Capture legal form, registration status, sector/activity, state/FCT, optional LGA, employees, turnover band and year, premises, manufacturing/importing and data-processing characteristics.",
    "acceptance": "“unknown” is valid and leads to uncertainty, not automatic exemption.",
    "sourceExactText": "PRO-001  Business profile  [R1 · Must] Capture legal form, registration status, sector/activity, state/FCT, optional LGA, employees, turnover band and year, premises, manufacturing/importing and data-processing characteristics. Accept: “unknown” is valid and leads to uncertainty, not automatic exemption.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:126",
    "owner": "Workspace / privacy QA",
    "dependencies": [
      "IAM-003",
      "PRV-001"
    ]
  },
  {
    "id": "PRO-002",
    "title": "Privacy and lifecycle",
    "release": "R1",
    "priority": "Must",
    "exactText": "Separate necessary processing notices from optional marketing consent; support profile correction, account export and deletion requests.",
    "acceptance": "the user can decline marketing and still use the product; consent versions and changes are recorded.",
    "sourceExactText": "PRO-002  Privacy and lifecycle  [R1 · Must] Separate necessary processing notices from optional marketing consent; support profile correction, account export and deletion requests. Accept: the user can decline marketing and still use the product; consent versions and changes are recorded.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:127",
    "owner": "Workspace / privacy QA",
    "dependencies": [
      "IAM-003",
      "PRV-001"
    ]
  },
  {
    "id": "PRO-003",
    "title": "Reassessment",
    "release": "R1",
    "priority": "Must",
    "exactText": "Version relevant profile changes and offer a new requirements assessment without overwriting the prior result.",
    "acceptance": "changed location, activities or employee count produces a dated comparison and preserves user-created tasks.",
    "sourceExactText": "PRO-003  Reassessment  [R1 · Must] Version relevant profile changes and offer a new requirements assessment without overwriting the prior result. Accept: changed location, activities or employee count produces a dated comparison and preserves user-created tasks.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:128",
    "owner": "Workspace / privacy QA",
    "dependencies": [
      "IAM-003",
      "PRV-001"
    ]
  },
  {
    "id": "DOC-001",
    "title": "Structured catalogue",
    "release": "R1",
    "priority": "Must",
    "exactText": "Each template must have an ID, slug, category, use case, industry tags, risk class, version, AI-review status, format, rights record and price/entitlement reference.",
    "acceptance": "incomplete evidence or failed publication gates prevent release; no professional reviewer identity is fabricated.",
    "sourceExactText": "DOC-001  Structured catalogue  [R1 · Must] Each template must have an ID, slug, category, use case, industry tags, risk class, version, AI-review status, format, rights record and price/entitlement reference. Accept: incomplete evidence or failed publication gates prevent release; no professional reviewer identity is fabricated.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:132",
    "owner": "Content / document QA",
    "dependencies": [
      "EDP-001–012",
      "PAY-003",
      "private object storage"
    ]
  },
  {
    "id": "DOC-002",
    "title": "Useful discovery",
    "release": "R1",
    "priority": "Must",
    "exactText": "Provide keyword search, category/industry/free-premium filters and relevance/name/recently-checked sorting; persist filters in the URL.",
    "acceptance": "combinations, pagination, reset and no-results suggestions work without exposing paid source files.",
    "sourceExactText": "DOC-002  Useful discovery  [R1 · Must] Provide keyword search, category/industry/free-premium filters and relevance/name/recently-checked sorting; persist filters in the URL. Accept: combinations, pagination, reset and no-results suggestions work without exposing paid source files.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:133",
    "owner": "Content / document QA",
    "dependencies": [
      "EDP-001–012",
      "PAY-003",
      "private object storage"
    ]
  },
  {
    "id": "DOC-003",
    "title": "Decision-ready detail",
    "release": "R1",
    "priority": "Must",
    "exactText": "Explain purpose, use, required inputs, limitations, formats, related guidance and revision date. Show AI drafting/review status and absence of professional review.",
    "acceptance": "higher-risk templates explain when independent advice may be useful and never promise enforceability, suitability or official approval.",
    "sourceExactText": "DOC-003  Decision-ready detail  [R1 · Must] Explain purpose, use, required inputs, limitations, formats, related guidance and revision date. Show AI drafting/review status and absence of professional review. Accept: higher-risk templates explain when independent advice may be useful and never promise enforceability, suitability or official approval.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:134",
    "owner": "Content / document QA",
    "dependencies": [
      "EDP-001–012",
      "PAY-003",
      "private object storage"
    ]
  },
  {
    "id": "DOC-004",
    "title": "Safe previews",
    "release": "R1",
    "priority": "Must",
    "exactText": "Serve a separately generated public preview that identifies sample fields and access conditions.",
    "acceptance": "restricted template content and downloadable masters are absent from public bundles, page source and unauthorised storage responses.",
    "sourceExactText": "DOC-004  Safe previews  [R1 · Must] Serve a separately generated public preview that identifies sample fields and access conditions. Accept: restricted template content and downloadable masters are absent from public bundles, page source and unauthorised storage responses.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:135",
    "owner": "Content / document QA",
    "dependencies": [
      "EDP-001–012",
      "PAY-003",
      "private object storage"
    ]
  },
  {
    "id": "DOC-005",
    "title": "Owned downloads",
    "release": "R1",
    "priority": "Must",
    "exactText": "Free templates may be downloaded after the chosen account gate; paid downloads require a valid server-checked entitlement.",
    "acceptance": "successful exports appear in the business library and remain linked to the template version used.",
    "sourceExactText": "DOC-005  Owned downloads  [R1 · Must] Free templates may be downloaded after the chosen account gate; paid downloads require a valid server-checked entitlement. Accept: successful exports appear in the business library and remain linked to the template version used.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:136",
    "owner": "Content / document QA",
    "dependencies": [
      "EDP-001–012",
      "PAY-003",
      "private object storage"
    ]
  },
  {
    "id": "DOC-006",
    "title": "Content ownership and licence",
    "release": "R1",
    "priority": "Must",
    "exactText": "Retain creation provenance, provider terms and commercial-use permissions for original, commissioned or licensed material. AI output alone does not prove rights clearance. Proposed licence: one business’s internal use, no template resale.",
    "acceptance": "source-checked terms pass editorial gates and the product owner accepts commercial terms before sales; counsel sign-off is not required by this plan.",
    "sourceExactText": "DOC-006  Content ownership and licence  [R1 · Must] Retain creation provenance, provider terms and commercial-use permissions for original, commissioned or licensed material. AI output alone does not prove rights clearance. Proposed licence: one business’s internal use, no template resale. Accept: source-checked terms pass editorial gates and the product owner accepts commercial terms before sales; counsel sign-off is not required by this plan.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:137",
    "owner": "Content / document QA",
    "dependencies": [
      "EDP-001–012",
      "PAY-003",
      "private object storage"
    ]
  },
  {
    "id": "DOC-007",
    "title": "Version and withdrawal handling",
    "release": "R1",
    "priority": "Must",
    "exactText": "Keep purchased historical versions and generated drafts traceable. Warn about material updates; withdraw unsafe masters from new use and explain available remediation.",
    "acceptance": "an update never silently rewrites a customer’s saved document.",
    "sourceExactText": "DOC-007  Version and withdrawal handling  [R1 · Must] Keep purchased historical versions and generated drafts traceable. Warn about material updates; withdraw unsafe masters from new use and explain available remediation. Accept: an update never silently rewrites a customer’s saved document.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:138",
    "owner": "Content / document QA",
    "dependencies": [
      "EDP-001–012",
      "PAY-003",
      "private object storage"
    ]
  },
  {
    "id": "DOC-008",
    "title": "Government forms are separate",
    "release": "R1",
    "priority": "Must",
    "exactText": "Identify official forms by authority and official URL; do not rebrand preparation checklists as official filing forms.",
    "acceptance": "any downloadable government form has checked reuse rights, provenance and a current-link warning.",
    "sourceExactText": "DOC-008  Government forms are separate  [R1 · Must] Identify official forms by authority and official URL; do not rebrand preparation checklists as official filing forms. Accept: any downloadable government form has checked reuse rights, provenance and a current-link warning.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:139",
    "owner": "Content / document QA",
    "dependencies": [
      "EDP-001–012",
      "PAY-003",
      "private object storage"
    ]
  },
  {
    "id": "DOC-009",
    "title": "Saved items and coverage",
    "release": "R1",
    "priority": "Must",
    "exactText": "Allow signed-in owners to save/unsave templates and see relevant recommendations. Unsupported formats or templates must be labelled unavailable rather than simulated.",
    "acceptance": "favourites persist across devices and deleted records degrade gracefully.",
    "sourceExactText": "DOC-009  Saved items and coverage  [R1 · Must] Allow signed-in owners to save/unsave templates and see relevant recommendations. Unsupported formats or templates must be labelled unavailable rather than simulated. Accept: favourites persist across devices and deleted records degrade gracefully.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:140",
    "owner": "Content / document QA",
    "dependencies": [
      "EDP-001–012",
      "PAY-003",
      "private object storage"
    ]
  },
  {
    "id": "EDT-001",
    "title": "Guided forms",
    "release": "R1",
    "priority": "Must",
    "exactText": "Implement the 12 designated guided templates using typed field schemas, conditional questions, examples and server validation.",
    "acceptance": "required placeholders cannot be omitted silently, and inappropriate clauses are not selected solely from a broad industry label.",
    "sourceExactText": "EDT-001  Guided forms  [R1 · Must] Implement the 12 designated guided templates using typed field schemas, conditional questions, examples and server validation. Accept: required placeholders cannot be omitted silently, and inappropriate clauses are not selected solely from a broad industry label.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:146",
    "owner": "Document / concurrency QA",
    "dependencies": [
      "IAM-003",
      "canonical document schema",
      "durable queue",
      "private storage"
    ]
  },
  {
    "id": "EDT-002",
    "title": "Canonical document model",
    "release": "R1",
    "priority": "Must",
    "exactText": "Persist a structured document with paragraphs, lists, tables, field values, selected clauses, formatting tokens and template version.",
    "acceptance": "preview, DOCX and PDF use the same saved revision, not three independently generated texts.",
    "sourceExactText": "EDT-002  Canonical document model  [R1 · Must] Persist a structured document with paragraphs, lists, tables, field values, selected clauses, formatting tokens and template version. Accept: preview, DOCX and PDF use the same saved revision, not three independently generated texts.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:147",
    "owner": "Document / concurrency QA",
    "dependencies": [
      "IAM-003",
      "canonical document schema",
      "durable queue",
      "private storage"
    ]
  },
  {
    "id": "EDT-003",
    "title": "Review and editing",
    "release": "R1",
    "priority": "Must",
    "exactText": "Support section-level text editing, undo, preview and a clear draft status.",
    "acceptance": "changes remain after reload and login on another device; locked guidance is distinguished from editable business content.",
    "sourceExactText": "EDT-003  Review and editing  [R1 · Must] Support section-level text editing, undo, preview and a clear draft status. Accept: changes remain after reload and login on another device; locked guidance is distinguished from editable business content.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:148",
    "owner": "Document / concurrency QA",
    "dependencies": [
      "IAM-003",
      "canonical document schema",
      "durable queue",
      "private storage"
    ]
  },
  {
    "id": "EDT-004",
    "title": "Autosave and concurrency",
    "release": "R1",
    "priority": "Must",
    "exactText": "Debounce saves, show saving/saved/offline states and send an expected revision number. Reject stale writes with a conflict response.",
    "acceptance": "two open tabs cannot silently overwrite each other; retry preserves unsaved text in memory.",
    "sourceExactText": "EDT-004  Autosave and concurrency  [R1 · Must] Debounce saves, show saving/saved/offline states and send an expected revision number. Reject stale writes with a conflict response. Accept: two open tabs cannot silently overwrite each other; retry preserves unsaved text in memory.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:149",
    "owner": "Document / concurrency QA",
    "dependencies": [
      "IAM-003",
      "canonical document schema",
      "durable queue",
      "private storage"
    ]
  },
  {
    "id": "EDT-005",
    "title": "Missing-data protection",
    "release": "R1",
    "priority": "Must",
    "exactText": "Highlight unresolved fields, inconsistent dates and missing party details.",
    "acceptance": "final export blocks mandatory omissions or requires a deliberately watermarked incomplete draft; never invent legal names, addresses or signatures.",
    "sourceExactText": "EDT-005  Missing-data protection  [R1 · Must] Highlight unresolved fields, inconsistent dates and missing party details. Accept: final export blocks mandatory omissions or requires a deliberately watermarked incomplete draft; never invent legal names, addresses or signatures.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:150",
    "owner": "Document / concurrency QA",
    "dependencies": [
      "IAM-003",
      "canonical document schema",
      "durable queue",
      "private storage"
    ]
  },
  {
    "id": "EDT-006",
    "title": "Real file generation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Produce editable DOCX and readable A4 PDF outputs through a server-side render job.",
    "acceptance": "each guided template opens in Word and a standard PDF reader; long names, multi-page tables and the naira symbol render correctly. [S22–S23]",
    "sourceExactText": "EDT-006  Real file generation  [R1 · Must] Produce editable DOCX and readable A4 PDF outputs through a server-side render job. Accept: each guided template opens in Word and a standard PDF reader; long names, multi-page tables and the naira symbol render correctly. [S22–S23]",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:151",
    "owner": "Document / concurrency QA",
    "dependencies": [
      "IAM-003",
      "canonical document schema",
      "durable queue",
      "private storage"
    ]
  },
  {
    "id": "EDT-007",
    "title": "Durable export jobs",
    "release": "R1",
    "priority": "Must",
    "exactText": "Create an idempotent job keyed to document revision, format and render version; provide progress, retry and failure detail.",
    "acceptance": "worker restart does not lose the job and repeated requests do not create uncontrolled duplicate exports.",
    "sourceExactText": "EDT-007  Durable export jobs  [R1 · Must] Create an idempotent job keyed to document revision, format and render version; provide progress, retry and failure detail. Accept: worker restart does not lose the job and repeated requests do not create uncontrolled duplicate exports.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:152",
    "owner": "Document / concurrency QA",
    "dependencies": [
      "IAM-003",
      "canonical document schema",
      "durable queue",
      "private storage"
    ]
  },
  {
    "id": "EDT-008",
    "title": "Private retrieval",
    "release": "R1",
    "priority": "Must",
    "exactText": "Stream authorised files through the application or use short-lived scoped URLs only where supported and tested.",
    "acceptance": "expired/revoked access fails; browsers and shared caches do not retain private responses as public assets.",
    "sourceExactText": "EDT-008  Private retrieval  [R1 · Must] Stream authorised files through the application or use short-lived scoped URLs only where supported and tested. Accept: expired/revoked access fails; browsers and shared caches do not retain private responses as public assets.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:153",
    "owner": "Document / concurrency QA",
    "dependencies": [
      "IAM-003",
      "canonical document schema",
      "durable queue",
      "private storage"
    ]
  },
  {
    "id": "EDT-009",
    "title": "Bounded formatting",
    "release": "R1",
    "priority": "Must",
    "exactText": "Support a tested set of typography, lists, tables, headers and branding options. R1 excludes arbitrary DOCX import, real-time co-editing, embedded macros and electronic signature execution.",
    "acceptance": "unsupported content cannot trigger remote network fetches or code execution.",
    "sourceExactText": "EDT-009  Bounded formatting  [R1 · Must] Support a tested set of typography, lists, tables, headers and branding options. R1 excludes arbitrary DOCX import, real-time co-editing, embedded macros and electronic signature execution. Accept: unsupported content cannot trigger remote network fetches or code execution.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:154",
    "owner": "Document / concurrency QA",
    "dependencies": [
      "IAM-003",
      "canonical document schema",
      "durable queue",
      "private storage"
    ]
  },
  {
    "id": "EDT-010",
    "title": "Ownership after changes",
    "release": "R1",
    "priority": "Must",
    "exactText": "Saved drafts remain the customer’s work even when an entitlement is refunded or a master is retired; future reuse/export policy must be disclosed.",
    "acceptance": "revoking platform access is never described as retracting a previously downloaded local file.",
    "sourceExactText": "EDT-010  Ownership after changes  [R1 · Must] Saved drafts remain the customer’s work even when an entitlement is refunded or a master is retired; future reuse/export policy must be disclosed. Accept: revoking platform access is never described as retracting a previously downloaded local file.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:155",
    "owner": "Document / concurrency QA",
    "dependencies": [
      "IAM-003",
      "canonical document schema",
      "durable queue",
      "private storage"
    ]
  },
  {
    "id": "AI-001",
    "title": "Supported tasks and user control",
    "release": "R1",
    "priority": "Must",
    "exactText": "Allow invoice, quotation, payment-reminder and business-proposal drafting. Ask targeted follow-up questions and show a structured draft before acceptance.",
    "acceptance": "unsupported customer legal requests are directed to a scoped published resource, official authority or independent adviser; no adviser availability is implied.",
    "sourceExactText": "AI-001  Supported tasks and user control  [R1 · Must] Allow invoice, quotation, payment-reminder and business-proposal drafting. Ask targeted follow-up questions and show a structured draft before acceptance. Accept: unsupported customer legal requests are directed to a scoped published resource, official authority or independent adviser; no adviser availability is implied.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:160",
    "owner": "AI integration / independent QA",
    "dependencies": [
      "provider approval/configuration",
      "schema validation",
      "quota policy"
    ]
  },
  {
    "id": "AI-002",
    "title": "Bounded generation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Provide the chosen template schema and permitted fields/sections; validate the returned structured result before rendering.",
    "acceptance": "invalid output is retried once under policy, then fails safely with the manual editor available.",
    "sourceExactText": "AI-002  Bounded generation  [R1 · Must] Provide the chosen template schema and permitted fields/sections; validate the returned structured result before rendering. Accept: invalid output is retried once under policy, then fails safely with the manual editor available.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:161",
    "owner": "AI integration / independent QA",
    "dependencies": [
      "provider approval/configuration",
      "schema validation",
      "quota policy"
    ]
  },
  {
    "id": "AI-003",
    "title": "No invented business facts",
    "release": "R1",
    "priority": "Must",
    "exactText": "Preserve supplied names and amounts; mark missing facts explicitly. Calculate totals deterministically in application code using decimal-safe arithmetic.",
    "acceptance": "the model cannot invent a tax rate, registration number, approval, signature or payment receipt.",
    "sourceExactText": "AI-003  No invented business facts  [R1 · Must] Preserve supplied names and amounts; mark missing facts explicitly. Calculate totals deterministically in application code using decimal-safe arithmetic. Accept: the model cannot invent a tax rate, registration number, approval, signature or payment receipt.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:162",
    "owner": "AI integration / independent QA",
    "dependencies": [
      "provider approval/configuration",
      "schema validation",
      "quota policy"
    ]
  },
  {
    "id": "AI-004",
    "title": "Governed applicability",
    "release": "R1",
    "priority": "Must",
    "exactText": "Keep customer assessments deterministic and source-governed. Customer AI may explain released text but cannot invent obligations, deadlines or exemptions. Internal AI may propose and publish changes only through EDP-001–012.",
    "acceptance": "ungrounded claims and unreleased rules never enter live assessments.",
    "sourceExactText": "AI-004  Governed applicability  [R1 · Must] Keep customer assessments deterministic and source-governed. Customer AI may explain released text but cannot invent obligations, deadlines or exemptions. Internal AI may propose and publish changes only through EDP-001–012. Accept: ungrounded claims and unreleased rules never enter live assessments.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:163",
    "owner": "AI integration / independent QA",
    "dependencies": [
      "provider approval/configuration",
      "schema validation",
      "quota policy"
    ]
  },
  {
    "id": "AI-005",
    "title": "Privacy-aware input",
    "release": "R1",
    "priority": "Must",
    "exactText": "Explain what is sent to the model; minimise fields and redact unnecessary identifiers. Never send another tenant’s data or secrets.",
    "acceptance": "test payloads prove only the selected document context is transmitted and no customer content enters generic analytics.",
    "sourceExactText": "AI-005  Privacy-aware input  [R1 · Must] Explain what is sent to the model; minimise fields and redact unnecessary identifiers. Never send another tenant’s data or secrets. Accept: test payloads prove only the selected document context is transmitted and no customer content enters generic analytics.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:164",
    "owner": "AI integration / independent QA",
    "dependencies": [
      "provider approval/configuration",
      "schema validation",
      "quota policy"
    ]
  },
  {
    "id": "AI-006",
    "title": "Injection and tool controls",
    "release": "R1",
    "priority": "Must",
    "exactText": "Treat user text and retrieved content as untrusted data. Customer drafting calls have no filing, email, payment or arbitrary browsing tools. Internal source retrieval and publication use separately scoped services under EDP-009.",
    "acceptance": "prompts cannot override permissions, change policy or execute unauthorised actions.",
    "sourceExactText": "AI-006  Injection and tool controls  [R1 · Must] Treat user text and retrieved content as untrusted data. Customer drafting calls have no filing, email, payment or arbitrary browsing tools. Internal source retrieval and publication use separately scoped services under EDP-009. Accept: prompts cannot override permissions, change policy or execute unauthorised actions.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:165",
    "owner": "AI integration / independent QA",
    "dependencies": [
      "provider approval/configuration",
      "schema validation",
      "quota policy"
    ]
  },
  {
    "id": "AI-007",
    "title": "Traceability and quotas",
    "release": "R1",
    "priority": "Must",
    "exactText": "Record model/configuration, prompt-template version, latency, outcome and token/cost metadata without retaining raw prompts in routine logs. Enforce workspace and global limits.",
    "acceptance": "a quota breach stops new AI calls without blocking manual document access.",
    "sourceExactText": "AI-007  Traceability and quotas  [R1 · Must] Record model/configuration, prompt-template version, latency, outcome and token/cost metadata without retaining raw prompts in routine logs. Enforce workspace and global limits. Accept: a quota breach stops new AI calls without blocking manual document access.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:166",
    "owner": "AI integration / independent QA",
    "dependencies": [
      "provider approval/configuration",
      "schema validation",
      "quota policy"
    ]
  },
  {
    "id": "AI-008",
    "title": "Customer drafting quality gate",
    "release": "R1",
    "priority": "Must",
    "exactText": "Maintain 60 source/rubric-backed cases across the four tasks, missing inputs and adversarial text.",
    "acceptance": "at least 95% meet the rubric, every financial calculation is correct and no critical leak or invented legal claim remains. Keep this separate from the editorial suite in EDP-010; neither measures certified legal accuracy.",
    "sourceExactText": "AI-008  Customer drafting quality gate  [R1 · Must] Maintain 60 source/rubric-backed cases across the four tasks, missing inputs and adversarial text. Accept: at least 95% meet the rubric, every financial calculation is correct and no critical leak or invented legal claim remains. Keep this separate from the editorial suite in EDP-010; neither measures certified legal accuracy.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:167",
    "owner": "AI integration / independent QA",
    "dependencies": [
      "provider approval/configuration",
      "schema validation",
      "quota policy"
    ]
  },
  {
    "id": "AI-009",
    "title": "Graceful failure",
    "release": "R1",
    "priority": "Must",
    "exactText": "Use timeouts, bounded retries and a feature kill switch; return useful guidance during provider failure.",
    "acceptance": "a model outage does not break paid downloads, free guidance or the deterministic editor.",
    "sourceExactText": "AI-009  Graceful failure  [R1 · Must] Use timeouts, bounded retries and a feature kill switch; return useful guidance during provider failure. Accept: a model outage does not break paid downloads, free guidance or the deterministic editor.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:168",
    "owner": "AI integration / independent QA",
    "dependencies": [
      "provider approval/configuration",
      "schema validation",
      "quota policy"
    ]
  },
  {
    "id": "CMP-001",
    "title": "Required content structure",
    "release": "R1",
    "priority": "Must",
    "exactText": "Record authority, jurisdiction, activity/legal form, conditions, action, evidence, source, effective period, AI-review status and related templates.",
    "acceptance": "missing authoritative evidence, scope or review manifest blocks publication of the affected claim; a human reviewer is not a required field.",
    "sourceExactText": "CMP-001  Required content structure  [R1 · Must] Record authority, jurisdiction, activity/legal form, conditions, action, evidence, source, effective period, AI-review status and related templates. Accept: missing authoritative evidence, scope or review manifest blocks publication of the affected claim; a human reviewer is not a required field.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:173",
    "owner": "Evidence / content QA",
    "dependencies": [
      "EDP-001–012",
      "retrieved authoritative source text"
    ]
  },
  {
    "id": "CMP-002",
    "title": "Applicability language",
    "release": "R1",
    "priority": "Must",
    "exactText": "Use “Likely relevant”, “May apply”, “More information needed” or “Not indicated by these answers”.",
    "acceptance": "no output states that the business is legally exempt or fully compliant merely because a questionnaire did not trigger a rule.",
    "sourceExactText": "CMP-002  Applicability language  [R1 · Must] Use “Likely relevant”, “May apply”, “More information needed” or “Not indicated by these answers”. Accept: no output states that the business is legally exempt or fully compliant merely because a questionnaire did not trigger a rule.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:174",
    "owner": "Evidence / content QA",
    "dependencies": [
      "EDP-001–012",
      "retrieved authoritative source text"
    ]
  },
  {
    "id": "CMP-003",
    "title": "Federal, state and local separation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Represent federal, state/FCT and LGA requirements separately, including activity-specific overlaps.",
    "acceptance": "a Lagos-only entry cannot appear as a national requirement, and an unknown LGA never receives invented local obligations.",
    "sourceExactText": "CMP-003  Federal, state and local separation  [R1 · Must] Represent federal, state/FCT and LGA requirements separately, including activity-specific overlaps. Accept: a Lagos-only entry cannot appear as a national requirement, and an unknown LGA never receives invented local obligations.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:175",
    "owner": "Evidence / content QA",
    "dependencies": [
      "EDP-001–012",
      "retrieved authoritative source text"
    ]
  },
  {
    "id": "CMP-004",
    "title": "Sources and review dates",
    "release": "R1",
    "priority": "Must",
    "exactText": "Store official URL, title, passage locator, retrieved text/snapshot hash, effective dates and supported interpretation. Separate sourceFetchedAt, aiReviewedAt and publishedAt.",
    "acceptance": "labels say “AI reviewed” or “Source checked”; “professionally reviewed” appears only if that review actually occurred and was recorded.",
    "sourceExactText": "CMP-004  Sources and review dates  [R1 · Must] Store official URL, title, passage locator, retrieved text/snapshot hash, effective dates and supported interpretation. Separate sourceFetchedAt, aiReviewedAt and publishedAt. Accept: labels say “AI reviewed” or “Source checked”; “professionally reviewed” appears only if that review actually occurred and was recorded.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:176",
    "owner": "Evidence / content QA",
    "dependencies": [
      "EDP-001–012",
      "retrieved authoritative source text"
    ]
  },
  {
    "id": "CMP-005",
    "title": "Legal updates and historic periods",
    "release": "R1",
    "priority": "Must",
    "exactText": "Version changes; preserve superseded interpretations and period applicability; show correction notices when material.",
    "acceptance": "running the same profile under two rule versions remains reproducible and explains changed recommendations.",
    "sourceExactText": "CMP-005  Legal updates and historic periods  [R1 · Must] Version changes; preserve superseded interpretations and period applicability; show correction notices when material. Accept: running the same profile under two rule versions remains reproducible and explains changed recommendations.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:177",
    "owner": "Evidence / content QA",
    "dependencies": [
      "EDP-001–012",
      "retrieved authoritative source text"
    ]
  },
  {
    "id": "CMP-006",
    "title": "Deadlines and fees",
    "release": "R1",
    "priority": "Must",
    "exactText": "Show a deadline, rate, threshold or fee only when its scope and source are approved. Distinguish government fees from Valo/provider charges.",
    "acceptance": "missing evidence shows “Confirm with the authority”; an assumed due date is never scheduled automatically.",
    "sourceExactText": "CMP-006  Deadlines and fees  [R1 · Must] Show a deadline, rate, threshold or fee only when its scope and source are approved. Distinguish government fees from Valo/provider charges. Accept: missing evidence shows “Confirm with the authority”; an assumed due date is never scheduled automatically.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:178",
    "owner": "Evidence / content QA",
    "dependencies": [
      "EDP-001–012",
      "retrieved authoritative source text"
    ]
  },
  {
    "id": "CMP-007",
    "title": "Freshness and conflicts",
    "release": "R1",
    "priority": "Must",
    "exactText": "Monitor source changes, failed retrieval and review expiry. Trigger an AI reassessment; hold affected high-impact claims until evidence and tests pass.",
    "acceptance": "stale or unresolved numeric rules cannot generate definite recommendations or new statutory reminders; show an uncertainty notice and official route.",
    "sourceExactText": "CMP-007  Freshness and conflicts  [R1 · Must] Monitor source changes, failed retrieval and review expiry. Trigger an AI reassessment; hold affected high-impact claims until evidence and tests pass. Accept: stale or unresolved numeric rules cannot generate definite recommendations or new statutory reminders; show an uncertainty notice and official route.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:179",
    "owner": "Evidence / content QA",
    "dependencies": [
      "EDP-001–012",
      "retrieved authoritative source text"
    ]
  },
  {
    "id": "CMP-008",
    "title": "AI editorial control",
    "release": "R1",
    "priority": "Must",
    "exactText": "Apply EDP-001–012 to tax, employment, privacy and sector material, with stricter evidence checks for high-impact content.",
    "acceptance": "separate drafting and review runs plus deterministic gates control automated publication. No Nigerian specialist or second human approval is required; a named owner can pause or withdraw content.",
    "sourceExactText": "CMP-008  AI editorial control  [R1 · Must] Apply EDP-001–012 to tax, employment, privacy and sector material, with stricter evidence checks for high-impact content. Accept: separate drafting and review runs plus deterministic gates control automated publication. No Nigerian specialist or second human approval is required; a named owner can pause or withdraw content.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:180",
    "owner": "Evidence / content QA",
    "dependencies": [
      "EDP-001–012",
      "retrieved authoritative source text"
    ]
  },
  {
    "id": "CMP-009",
    "title": "Free and understandable",
    "release": "R1",
    "priority": "Must",
    "exactText": "Explain the practical next step, why it may matter and what information is missing in plain English.",
    "acceptance": "the source and basic guidance remain readable without purchase and are not disguised professional endorsements.",
    "sourceExactText": "CMP-009  Free and understandable  [R1 · Must] Explain the practical next step, why it may matter and what information is missing in plain English. Accept: the source and basic guidance remain readable without purchase and are not disguised professional endorsements.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:181",
    "owner": "Evidence / content QA",
    "dependencies": [
      "EDP-001–012",
      "retrieved authoritative source text"
    ]
  },
  {
    "id": "RUL-001",
    "title": "Configurable questionnaire",
    "release": "R1",
    "priority": "Must",
    "exactText": "Use progressive questions driven by activity, legal form, locations, employment, turnover period, product type and personal-data handling.",
    "acceptance": "irrelevant questions are skipped, progress is clear, and the user can return to previous answers.",
    "sourceExactText": "RUL-001  Configurable questionnaire  [R1 · Must] Use progressive questions driven by activity, legal form, locations, employment, turnover period, product type and personal-data handling. Accept: irrelevant questions are skipped, progress is clear, and the user can return to previous answers.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:186",
    "owner": "Rules / independent QA",
    "dependencies": [
      "CMP-001–008",
      "EDP-001–012",
      "versioned profile"
    ]
  },
  {
    "id": "RUL-002",
    "title": "Unknown is a first-class state",
    "release": "R1",
    "priority": "Must",
    "exactText": "Represent unknown, unanswered and not-applicable separately from false/zero.",
    "acceptance": "missing turnover, workforce or location information generates a follow-up or uncertainty label, never an exemption.",
    "sourceExactText": "RUL-002  Unknown is a first-class state  [R1 · Must] Represent unknown, unanswered and not-applicable separately from false/zero. Accept: missing turnover, workforce or location information generates a follow-up or uncertainty label, never an exemption.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:187",
    "owner": "Rules / independent QA",
    "dependencies": [
      "CMP-001–008",
      "EDP-001–012",
      "versioned profile"
    ]
  },
  {
    "id": "RUL-003",
    "title": "Deterministic rules",
    "release": "R1",
    "priority": "Must",
    "exactText": "Execute versioned declarative conditions using allowlisted operators. AI may author rules offline through EDP gates, but cannot create or modify them during a customer assessment.",
    "acceptance": "equal input, assessment date and released ruleset version give equal results; arbitrary code is rejected.",
    "sourceExactText": "RUL-003  Deterministic rules  [R1 · Must] Execute versioned declarative conditions using allowlisted operators. AI may author rules offline through EDP gates, but cannot create or modify them during a customer assessment. Accept: equal input, assessment date and released ruleset version give equal results; arbitrary code is rejected.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:188",
    "owner": "Rules / independent QA",
    "dependencies": [
      "CMP-001–008",
      "EDP-001–012",
      "versioned profile"
    ]
  },
  {
    "id": "RUL-004",
    "title": "Explainability",
    "release": "R1",
    "priority": "Must",
    "exactText": "Return matched facts, requirement ID/version, jurisdiction, source references, confidence label and missing facts.",
    "acceptance": "every recommendation exposes a plain-English “Why am I seeing this?” explanation.",
    "sourceExactText": "RUL-004  Explainability  [R1 · Must] Return matched facts, requirement ID/version, jurisdiction, source references, confidence label and missing facts. Accept: every recommendation exposes a plain-English “Why am I seeing this?” explanation.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:189",
    "owner": "Rules / independent QA",
    "dependencies": [
      "CMP-001–008",
      "EDP-001–012",
      "versioned profile"
    ]
  },
  {
    "id": "RUL-005",
    "title": "Threshold-safe evaluation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Where an approved rule has a numeric threshold, compare the proper metric, currency, accounting period and effective date.",
    "acceptance": "a broad turnover band that straddles a threshold requests more information instead of forcing a result.",
    "sourceExactText": "RUL-005  Threshold-safe evaluation  [R1 · Must] Where an approved rule has a numeric threshold, compare the proper metric, currency, accounting period and effective date. Accept: a broad turnover band that straddles a threshold requests more information instead of forcing a result.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:190",
    "owner": "Rules / independent QA",
    "dependencies": [
      "CMP-001–008",
      "EDP-001–012",
      "versioned profile"
    ]
  },
  {
    "id": "RUL-006",
    "title": "Complete but bounded results",
    "release": "R1",
    "priority": "Must",
    "exactText": "Separate recommended documents, potentially relevant requirements, unanswered questions and next steps.",
    "acceptance": "coverage gaps and excluded high-risk sectors are visible; no compliance score implies a legal certification.",
    "sourceExactText": "RUL-006  Complete but bounded results  [R1 · Must] Separate recommended documents, potentially relevant requirements, unanswered questions and next steps. Accept: coverage gaps and excluded high-risk sectors are visible; no compliance score implies a legal certification.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:191",
    "owner": "Rules / independent QA",
    "dependencies": [
      "CMP-001–008",
      "EDP-001–012",
      "versioned profile"
    ]
  },
  {
    "id": "RUL-007",
    "title": "Versioned assessment records",
    "release": "R1",
    "priority": "Must",
    "exactText": "Persist the consented profile snapshot, rule versions, evaluation date and result hashes for signed-in users.",
    "acceptance": "users can compare assessments; anonymous answers are cleared unless they explicitly choose to save.",
    "sourceExactText": "RUL-007  Versioned assessment records  [R1 · Must] Persist the consented profile snapshot, rule versions, evaluation date and result hashes for signed-in users. Accept: users can compare assessments; anonymous answers are cleared unless they explicitly choose to save.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:192",
    "owner": "Rules / independent QA",
    "dependencies": [
      "CMP-001–008",
      "EDP-001–012",
      "versioned profile"
    ]
  },
  {
    "id": "RUL-008",
    "title": "Regression and boundary tests",
    "release": "R1",
    "priority": "Must",
    "exactText": "Maintain at least 80 source-backed scenarios across six sectors, three checked locations, other-state gaps, unknowns and effective-date boundaries. Use a separate AI validation run to challenge expected results.",
    "acceptance": "all critical results and exclusions pass; unresolved interpretations remain held.",
    "sourceExactText": "RUL-008  Regression and boundary tests  [R1 · Must] Maintain at least 80 source-backed scenarios across six sectors, three checked locations, other-state gaps, unknowns and effective-date boundaries. Use a separate AI validation run to challenge expected results. Accept: all critical results and exclusions pass; unresolved interpretations remain held.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:193",
    "owner": "Rules / independent QA",
    "dependencies": [
      "CMP-001–008",
      "EDP-001–012",
      "versioned profile"
    ]
  },
  {
    "id": "RUL-009",
    "title": "Safe updates and scheduling",
    "release": "R1",
    "priority": "Must",
    "exactText": "Generate task suggestions from approved results, but require user confirmation of dates and reminders where information is incomplete.",
    "acceptance": "a rule change flags existing tasks for review rather than silently deleting or backdating them.",
    "sourceExactText": "RUL-009  Safe updates and scheduling  [R1 · Must] Generate task suggestions from approved results, but require user confirmation of dates and reminders where information is incomplete. Accept: a rule change flags existing tasks for review rather than silently deleting or backdating them.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:194",
    "owner": "Rules / independent QA",
    "dependencies": [
      "CMP-001–008",
      "EDP-001–012",
      "versioned profile"
    ]
  },
  {
    "id": "WRK-001",
    "title": "Business workspace",
    "release": "R1",
    "priority": "Must",
    "exactText": "Show profile, saved templates, drafts, purchases, assessment history, tasks and enquiries.",
    "acceptance": "all data survives refresh and device changes; localStorage is limited to non-sensitive display preferences.",
    "sourceExactText": "WRK-001  Business workspace  [R1 · Must] Show profile, saved templates, drafts, purchases, assessment history, tasks and enquiries. Accept: all data survives refresh and device changes; localStorage is limited to non-sensitive display preferences.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:200",
    "owner": "Workspace / messaging QA",
    "dependencies": [
      "IAM-003",
      "transactional email",
      "consent preferences"
    ]
  },
  {
    "id": "WRK-002",
    "title": "Personal task tracking",
    "release": "R1",
    "priority": "Must",
    "exactText": "Support not-started, in-progress, completed-by-user and needs-review states, with notes and optional due dates.",
    "acceptance": "a user-completed item is never described as accepted by a regulator.",
    "sourceExactText": "WRK-002  Personal task tracking  [R1 · Must] Support not-started, in-progress, completed-by-user and needs-review states, with notes and optional due dates. Accept: a user-completed item is never described as accepted by a regulator.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:201",
    "owner": "Workspace / messaging QA",
    "dependencies": [
      "IAM-003",
      "transactional email",
      "consent preferences"
    ]
  },
  {
    "id": "WRK-003",
    "title": "Reminders",
    "release": "R1",
    "priority": "Must",
    "exactText": "Offer opt-in email reminders using Africa/Lagos scheduling, configurable offsets and a delivery log.",
    "acceptance": "duplicate scheduler runs do not duplicate messages; unknown statutory dates cannot become automatic deadlines.",
    "sourceExactText": "WRK-003  Reminders  [R1 · Must] Offer opt-in email reminders using Africa/Lagos scheduling, configurable offsets and a delivery log. Accept: duplicate scheduler runs do not duplicate messages; unknown statutory dates cannot become automatic deadlines.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:202",
    "owner": "Workspace / messaging QA",
    "dependencies": [
      "IAM-003",
      "transactional email",
      "consent preferences"
    ]
  },
  {
    "id": "WRK-004",
    "title": "Delivery preferences",
    "release": "R1",
    "priority": "Must",
    "exactText": "Separate necessary account/purchase messages from optional reminders and marketing.",
    "acceptance": "unsubscribe and preference changes are enforced before dispatch, not just when the job was created.",
    "sourceExactText": "WRK-004  Delivery preferences  [R1 · Must] Separate necessary account/purchase messages from optional reminders and marketing. Accept: unsubscribe and preference changes are enforced before dispatch, not just when the job was created.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:203",
    "owner": "Workspace / messaging QA",
    "dependencies": [
      "IAM-003",
      "transactional email",
      "consent preferences"
    ]
  },
  {
    "id": "WRK-005",
    "title": "Private evidence boundary",
    "release": "R1",
    "priority": "Must",
    "exactText": "R1 stores structured task notes and references, not uploaded identity or regulatory evidence files.",
    "acceptance": "upload controls are absent or disabled. Evidence uploads are R2 and require malware scanning, access controls and retention review.",
    "sourceExactText": "WRK-005  Private evidence boundary  [R1 · Must] R1 stores structured task notes and references, not uploaded identity or regulatory evidence files. Accept: upload controls are absent or disabled. Evidence uploads are R2 and require malware scanning, access controls and retention review.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:204",
    "owner": "Workspace / messaging QA",
    "dependencies": [
      "IAM-003",
      "transactional email",
      "consent preferences"
    ]
  },
  {
    "id": "WRK-006",
    "title": "Activity and support",
    "release": "R1",
    "priority": "Must",
    "exactText": "Record meaningful user events and offer a support form with a ticket reference.",
    "acceptance": "logs omit draft bodies and unnecessary personal details; support confirms receipt only after the ticket is durably saved.",
    "sourceExactText": "WRK-006  Activity and support  [R1 · Must] Record meaningful user events and offer a support form with a ticket reference. Accept: logs omit draft bodies and unnecessary personal details; support confirms receipt only after the ticket is durably saved.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:205",
    "owner": "Workspace / messaging QA",
    "dependencies": [
      "IAM-003",
      "transactional email",
      "consent preferences"
    ]
  },
  {
    "id": "SRV-001",
    "title": "Service discovery",
    "release": "R1",
    "priority": "Must",
    "exactText": "Explain registration, tax, accounting, employment, legal, privacy and sector-approval assistance.",
    "acceptance": "service pages are useful even when no provider is listed and do not imply government affiliation.",
    "sourceExactText": "SRV-001  Service discovery  [R1 · Must] Explain registration, tax, accounting, employment, legal, privacy and sector-approval assistance. Accept: service pages are useful even when no provider is listed and do not imply government affiliation.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:206",
    "owner": "Service operations / QA",
    "dependencies": [
      "actual support workflow",
      "provider identity and permission where listed"
    ]
  },
  {
    "id": "SRV-002",
    "title": "Real enquiries",
    "release": "R1",
    "priority": "Must",
    "exactText": "At R1, capture the category, scope, contact details and explicit sharing consent; route to Valo’s actual support workflow.",
    "acceptance": "the user sees “Enquiry received”, not “Appointment booked”; failed dispatch is visible to staff.",
    "sourceExactText": "SRV-002  Real enquiries  [R1 · Must] At R1, capture the category, scope, contact details and explicit sharing consent; route to Valo’s actual support workflow. Accept: the user sees “Enquiry received”, not “Appointment booked”; failed dispatch is visible to staff.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:207",
    "owner": "Service operations / QA",
    "dependencies": [
      "actual support workflow",
      "provider identity and permission where listed"
    ]
  },
  {
    "id": "SRV-003",
    "title": "Verified profiles only",
    "release": "R1",
    "priority": "Must",
    "exactText": "Publish providers only after identity, relevant credentials, permission and service descriptions are checked; show the scope/date of verification.",
    "acceptance": "no fictional provider, fabricated rating or unsupported “accredited” claim reaches production.",
    "sourceExactText": "SRV-003  Verified profiles only  [R1 · Must] Publish providers only after identity, relevant credentials, permission and service descriptions are checked; show the scope/date of verification. Accept: no fictional provider, fabricated rating or unsupported “accredited” claim reaches production.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:208",
    "owner": "Service operations / QA",
    "dependencies": [
      "actual support workflow",
      "provider identity and permission where listed"
    ]
  },
  {
    "id": "SRV-004",
    "title": "Future bookings",
    "release": "R2/R3",
    "priority": "Must",
    "exactText": "R2 enables quote and availability requests. R3 paid booking requires a separately gated cancellation, refund, dispute and settlement flow.",
    "acceptance": "booking or payment controls remain feature-disabled until that gate is approved.",
    "sourceExactText": "SRV-004  Future bookings  [R2/R3 · Must] R2 enables quote and availability requests. R3 paid booking requires a separately gated cancellation, refund, dispute and settlement flow. Accept: booking or payment controls remain feature-disabled until that gate is approved.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:209",
    "owner": "Service operations / QA",
    "dependencies": [
      "actual support workflow",
      "provider identity and permission where listed"
    ]
  },
  {
    "id": "PAY-001",
    "title": "Server-priced orders",
    "release": "R1",
    "priority": "Must",
    "exactText": "Create immutable order lines from the current approved price book, with tax treatment and total in integer kobo.",
    "acceptance": "a client-modified amount, currency, product or discount cannot alter the charged order.",
    "sourceExactText": "PAY-001  Server-priced orders  [R1 · Must] Create immutable order lines from the current approved price book, with tax treatment and total in integer kobo. Accept: a client-modified amount, currency, product or discount cannot alter the charged order.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:215",
    "owner": "Payments / finance / independent QA",
    "dependencies": [
      "PSP test account",
      "approved price/refund decisions before live",
      "database transactions"
    ]
  },
  {
    "id": "PAY-002",
    "title": "Hosted checkout",
    "release": "R1",
    "priority": "Must",
    "exactText": "Create the PSP session server-side and redirect to its supported hosted flow.",
    "acceptance": "Valo never stores card numbers, security codes or payment credentials; live and test modes use isolated keys and data.",
    "sourceExactText": "PAY-002  Hosted checkout  [R1 · Must] Create the PSP session server-side and redirect to its supported hosted flow. Accept: Valo never stores card numbers, security codes or payment credentials; live and test modes use isolated keys and data.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:216",
    "owner": "Payments / finance / independent QA",
    "dependencies": [
      "PSP test account",
      "approved price/refund decisions before live",
      "database transactions"
    ]
  },
  {
    "id": "PAY-003",
    "title": "Authoritative confirmation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Grant entitlement only after server verification of successful status, merchant transaction reference, order, amount and currency.",
    "acceptance": "a browser success URL alone cannot unlock a template.",
    "sourceExactText": "PAY-003  Authoritative confirmation  [R1 · Must] Grant entitlement only after server verification of successful status, merchant transaction reference, order, amount and currency. Accept: a browser success URL alone cannot unlock a template.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:217",
    "owner": "Payments / finance / independent QA",
    "dependencies": [
      "PSP test account",
      "approved price/refund decisions before live",
      "database transactions"
    ]
  },
  {
    "id": "PAY-004",
    "title": "Webhook authenticity",
    "release": "R1",
    "priority": "Must",
    "exactText": "Validate the raw-body signature with the provider’s supported scheme; apply replay checks where supported. Durably record validated events before acknowledgement.",
    "acceptance": "invalid, replayed and duplicate events cannot create a new purchase.",
    "sourceExactText": "PAY-004  Webhook authenticity  [R1 · Must] Validate the raw-body signature with the provider’s supported scheme; apply replay checks where supported. Durably record validated events before acknowledgement. Accept: invalid, replayed and duplicate events cannot create a new purchase.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:218",
    "owner": "Payments / finance / independent QA",
    "dependencies": [
      "PSP test account",
      "approved price/refund decisions before live",
      "database transactions"
    ]
  },
  {
    "id": "PAY-005",
    "title": "Atomic fulfilment",
    "release": "R1",
    "priority": "Must",
    "exactText": "Process order settlement, entitlement and receipt-outbox creation in one database transaction with uniqueness constraints.",
    "acceptance": "callback and webhook races, retries and worker restarts create one grant only.",
    "sourceExactText": "PAY-005  Atomic fulfilment  [R1 · Must] Process order settlement, entitlement and receipt-outbox creation in one database transaction with uniqueness constraints. Accept: callback and webhook races, retries and worker restarts create one grant only.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:219",
    "owner": "Payments / finance / independent QA",
    "dependencies": [
      "PSP test account",
      "approved price/refund decisions before live",
      "database transactions"
    ]
  },
  {
    "id": "PAY-006",
    "title": "Pending and failed payments",
    "release": "R1",
    "priority": "Must",
    "exactText": "Show pending, failed, abandoned and verified-success states and provide a safe status refresh.",
    "acceptance": "interrupted browser sessions recover their purchase without requiring an unnecessary second payment.",
    "sourceExactText": "PAY-006  Pending and failed payments  [R1 · Must] Show pending, failed, abandoned and verified-success states and provide a safe status refresh. Accept: interrupted browser sessions recover their purchase without requiring an unnecessary second payment.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:220",
    "owner": "Payments / finance / independent QA",
    "dependencies": [
      "PSP test account",
      "approved price/refund decisions before live",
      "database transactions"
    ]
  },
  {
    "id": "PAY-007",
    "title": "Reconciliation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Run daily transaction reconciliation and alert on unmatched amounts, missing events and fulfilment differences.",
    "acceptance": "finance can resolve a discrepancy with an audit trail and without editing financial history directly.",
    "sourceExactText": "PAY-007  Reconciliation  [R1 · Must] Run daily transaction reconciliation and alert on unmatched amounts, missing events and fulfilment differences. Accept: finance can resolve a discrepancy with an audit trail and without editing financial history directly.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:221",
    "owner": "Payments / finance / independent QA",
    "dependencies": [
      "PSP test account",
      "approved price/refund decisions before live",
      "database transactions"
    ]
  },
  {
    "id": "PAY-008",
    "title": "Refunds and disputes",
    "release": "R1",
    "priority": "Must",
    "exactText": "Implement approved refund eligibility, authorisation and PSP status tracking.",
    "acceptance": "a refund is not marked complete when merely requested; entitlement effects are explicit and user-owned drafts are not silently deleted.",
    "sourceExactText": "PAY-008  Refunds and disputes  [R1 · Must] Implement approved refund eligibility, authorisation and PSP status tracking. Accept: a refund is not marked complete when merely requested; entitlement effects are explicit and user-owned drafts are not silently deleted.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:222",
    "owner": "Payments / finance / independent QA",
    "dependencies": [
      "PSP test account",
      "approved price/refund decisions before live",
      "database transactions"
    ]
  },
  {
    "id": "PAY-009",
    "title": "Receipts and licence access",
    "release": "R1",
    "priority": "Must",
    "exactText": "Issue a Valo purchase receipt, show purchase history and allow re-download under the agreed licence.",
    "acceptance": "a generated business invoice is never confused with proof of payment or an official government tax invoice.",
    "sourceExactText": "PAY-009  Receipts and licence access  [R1 · Must] Issue a Valo purchase receipt, show purchase history and allow re-download under the agreed licence. Accept: a generated business invoice is never confused with proof of payment or an official government tax invoice.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:223",
    "owner": "Payments / finance / independent QA",
    "dependencies": [
      "PSP test account",
      "approved price/refund decisions before live",
      "database transactions"
    ]
  },
  {
    "id": "PAY-010",
    "title": "No unapproved billing expansion",
    "release": "R1",
    "priority": "Must",
    "exactText": "Keep recurring subscriptions, wallets, split settlements and provider collections off in R1.",
    "acceptance": "later billing products require approved economics, terms, failure handling and their own migration/reconciliation tests.",
    "sourceExactText": "PAY-010  No unapproved billing expansion  [R1 · Must] Keep recurring subscriptions, wallets, split settlements and provider collections off in R1. Accept: later billing products require approved economics, terms, failure handling and their own migration/reconciliation tests.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:224",
    "owner": "Payments / finance / independent QA",
    "dependencies": [
      "PSP test account",
      "approved price/refund decisions before live",
      "database transactions"
    ]
  },
  {
    "id": "ADM-001",
    "title": "Operational console",
    "release": "R1",
    "priority": "Must",
    "exactText": "Provide separate content, customer-support, finance and system areas with server-enforced roles.",
    "acceptance": "a finance user cannot read document bodies and an author cannot change payment configuration.",
    "sourceExactText": "ADM-001  Operational console  [R1 · Must] Provide separate content, customer-support, finance and system areas with server-enforced roles. Accept: a finance user cannot read document bodies and an author cannot change payment configuration.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:228",
    "owner": "Admin / independent security QA",
    "dependencies": [
      "IAM-002",
      "EDP-001–012",
      "separate role permissions"
    ]
  },
  {
    "id": "ADM-002",
    "title": "Editorial workflow",
    "release": "R1",
    "priority": "Must",
    "exactText": "Use draft → AI-review → validation → eligible → published → superseded/withdrawn, plus held.",
    "acceptance": "retain model/run IDs, findings, evidence, hashes and timestamps. A separate publisher service releases only eligible versions; no per-item human approval is needed and a drafting run cannot approve itself.",
    "sourceExactText": "ADM-002  Editorial workflow  [R1 · Must] Use draft → AI-review → validation → eligible → published → superseded/withdrawn, plus held. Accept: retain model/run IDs, findings, evidence, hashes and timestamps. A separate publisher service releases only eligible versions; no per-item human approval is needed and a drafting run cannot approve itself.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:229",
    "owner": "Admin / independent security QA",
    "dependencies": [
      "IAM-002",
      "EDP-001–012",
      "separate role permissions"
    ]
  },
  {
    "id": "ADM-003",
    "title": "Source registry",
    "release": "R1",
    "priority": "Must",
    "exactText": "Manage authorities, URLs, jurisdiction, instrument/effective versions, snapshots and next-check dates.",
    "acceptance": "a source change opens AI drafting/review and validation jobs; publication follows only after every gate passes, not directly from a crawler alert.",
    "sourceExactText": "ADM-003  Source registry  [R1 · Must] Manage authorities, URLs, jurisdiction, instrument/effective versions, snapshots and next-check dates. Accept: a source change opens AI drafting/review and validation jobs; publication follows only after every gate passes, not directly from a crawler alert.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:230",
    "owner": "Admin / independent security QA",
    "dependencies": [
      "IAM-002",
      "EDP-001–012",
      "separate role permissions"
    ]
  },
  {
    "id": "ADM-004",
    "title": "Rule publishing",
    "release": "R1",
    "priority": "Must",
    "exactText": "Validate condition schemas, preview affected profiles and run regression scenarios before publishing a new ruleset.",
    "acceptance": "failed critical tests block release and prior versions can be restored without losing assessment history.",
    "sourceExactText": "ADM-004  Rule publishing  [R1 · Must] Validate condition schemas, preview affected profiles and run regression scenarios before publishing a new ruleset. Accept: failed critical tests block release and prior versions can be restored without losing assessment history.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:231",
    "owner": "Admin / independent security QA",
    "dependencies": [
      "IAM-002",
      "EDP-001–012",
      "separate role permissions"
    ]
  },
  {
    "id": "ADM-005",
    "title": "Template release control",
    "release": "R1",
    "priority": "Must",
    "exactText": "Require provenance, rights evidence, rendered DOCX/PDF samples, scoped limitations and a passing AI review manifest.",
    "acceptance": "every published item has an immutable eligible version and reproducible export tests; specialist sign-off is not an acceptance dependency.",
    "sourceExactText": "ADM-005  Template release control  [R1 · Must] Require provenance, rights evidence, rendered DOCX/PDF samples, scoped limitations and a passing AI review manifest. Accept: every published item has an immutable eligible version and reproducible export tests; specialist sign-off is not an acceptance dependency.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:232",
    "owner": "Admin / independent security QA",
    "dependencies": [
      "IAM-002",
      "EDP-001–012",
      "separate role permissions"
    ]
  },
  {
    "id": "ADM-006",
    "title": "Commercial configuration",
    "release": "R1",
    "priority": "Must",
    "exactText": "Version prices, bundles, quotas and access rules with effective dates and a change log.",
    "acceptance": "historic orders retain their original terms and values after pricing changes.",
    "sourceExactText": "ADM-006  Commercial configuration  [R1 · Must] Version prices, bundles, quotas and access rules with effective dates and a change log. Accept: historic orders retain their original terms and values after pricing changes.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:233",
    "owner": "Admin / independent security QA",
    "dependencies": [
      "IAM-002",
      "EDP-001–012",
      "separate role permissions"
    ]
  },
  {
    "id": "ADM-007",
    "title": "Safety switches",
    "release": "R1",
    "priority": "Must",
    "exactText": "Allow authorised staff to disable an unsafe guide/rule/template, AI generation or checkout independently.",
    "acceptance": "free unaffected guidance remains available and the reason, actor and customer impact are recorded.",
    "sourceExactText": "ADM-007  Safety switches  [R1 · Must] Allow authorised staff to disable an unsafe guide/rule/template, AI generation or checkout independently. Accept: free unaffected guidance remains available and the reason, actor and customer impact are recorded.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:234",
    "owner": "Admin / independent security QA",
    "dependencies": [
      "IAM-002",
      "EDP-001–012",
      "separate role permissions"
    ]
  },
  {
    "id": "ADM-008",
    "title": "Support escalation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Track content complaints, payments, privacy requests and provider enquiries separately. Route content issues to the AI reassessment queue and accountable content owner.",
    "acceptance": "anyone can report an error free of charge; unresolved items are held or withdrawn without waiting for an unavailable specialist.",
    "sourceExactText": "ADM-008  Support escalation  [R1 · Must] Track content complaints, payments, privacy requests and provider enquiries separately. Route content issues to the AI reassessment queue and accountable content owner. Accept: anyone can report an error free of charge; unresolved items are held or withdrawn without waiting for an unavailable specialist.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:235",
    "owner": "Admin / independent security QA",
    "dependencies": [
      "IAM-002",
      "EDP-001–012",
      "separate role permissions"
    ]
  },
  {
    "id": "ADM-009",
    "title": "Audit integrity",
    "release": "R1",
    "priority": "Must",
    "exactText": "Record sensitive access, publication, role change, refund and recovery actions with actor, object, reason and timestamp.",
    "acceptance": "application users cannot modify audit history; tampering and excessive privileged access generate alerts.",
    "sourceExactText": "ADM-009  Audit integrity  [R1 · Must] Record sensitive access, publication, role change, refund and recovery actions with actor, object, reason and timestamp. Accept: application users cannot modify audit history; tampering and excessive privileged access generate alerts.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:236",
    "owner": "Admin / independent security QA",
    "dependencies": [
      "IAM-002",
      "EDP-001–012",
      "separate role permissions"
    ]
  },
  {
    "id": "EDP-001",
    "title": "Permitted publication scope",
    "release": "R1",
    "priority": "Must",
    "exactText": "The product owner sets allowed content classes, jurisdictions, risk levels and blocked activities once at policy level. AI can publish general templates and sourced guidance within that policy. Bespoke legal opinions, guarantees and professional certification are excluded.",
    "acceptance": "publication needs no human signature per item, but cannot expand its own scope.",
    "sourceExactText": "EDP-001  Permitted publication scope  [R1 · Must] The product owner sets allowed content classes, jurisdictions, risk levels and blocked activities once at policy level. AI can publish general templates and sourced guidance within that policy. Bespoke legal opinions, guarantees and professional certification are excluded. Accept: publication needs no human signature per item, but cannot expand its own scope.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:323",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "EDP-002",
    "title": "Evidence collection",
    "release": "R1",
    "priority": "Must",
    "exactText": "Retrieve authoritative instruments and current official guidance; retain actual text, title, issuing body, passage, jurisdiction, effective period, retrieval date and hash. News, search snippets and model memory are discovery aids only.",
    "acceptance": "failed retrieval, unclear amendments or missing operative provisions hold affected claims rather than generating substitutes.",
    "sourceExactText": "EDP-002  Evidence collection  [R1 · Must] Retrieve authoritative instruments and current official guidance; retain actual text, title, issuing body, passage, jurisdiction, effective period, retrieval date and hash. News, search snippets and model memory are discovery aids only. Accept: failed retrieval, unclear amendments or missing operative provisions hold affected claims rather than generating substitutes.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:324",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "EDP-003",
    "title": "AI drafting",
    "release": "R1",
    "priority": "Must",
    "exactText": "Draft from the approved evidence bundle and content schema. Map every material legal claim, deadline, rate and applicability condition to a supporting passage; distinguish source statements from interpretation and optional practice. Record missing evidence, assumptions, provenance and template rights.",
    "acceptance": "invented citations, business facts and rights assertions fail validation.",
    "sourceExactText": "EDP-003  AI drafting  [R1 · Must] Draft from the approved evidence bundle and content schema. Map every material legal claim, deadline, rate and applicability condition to a supporting passage; distinguish source statements from interpretation and optional practice. Record missing evidence, assumptions, provenance and template rights. Accept: invented citations, business facts and rights assertions fail validation.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:325",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "EDP-004",
    "title": "Separate AI checks",
    "release": "R1",
    "priority": "Must",
    "exactText": "Run a factual/source check and a separate challenge for scope, omissions, exceptions and misleading certainty, apart from drafting. Reviewers receive the source bundle and candidate, not each other’s verdict. Log model, prompt and run IDs; another model is optional.",
    "acceptance": "unexplained disagreement holds release. Model agreement is not independent professional validation.",
    "sourceExactText": "EDP-004  Separate AI checks  [R1 · Must] Run a factual/source check and a separate challenge for scope, omissions, exceptions and misleading certainty, apart from drafting. Reviewers receive the source bundle and candidate, not each other’s verdict. Log model, prompt and run IDs; another model is optional. Accept: unexplained disagreement holds release. Model agreement is not independent professional validation.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:326",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "EDP-005",
    "title": "Enhanced checks",
    "release": "R1",
    "priority": "Must",
    "exactText": "For tax, employment, privacy, governance, contracts and regulated-sector content, check controlling text, amendments, effective dates, exceptions and jurisdiction. Contract templates must expose party/use assumptions and unresolved clauses.",
    "acceptance": "a material uncertainty holds the whole template or inseparable rule; detachable unsupported claims may be removed and the complete item rechecked.",
    "sourceExactText": "EDP-005  Enhanced checks  [R1 · Must] For tax, employment, privacy, governance, contracts and regulated-sector content, check controlling text, amendments, effective dates, exceptions and jurisdiction. Contract templates must expose party/use assumptions and unresolved clauses. Accept: a material uncertainty holds the whole template or inseparable rule; detachable unsupported claims may be removed and the complete item rechecked.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:327",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "EDP-006",
    "title": "Mechanical validation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Validate schemas, source locators, dates, scope, numeric extraction, rights records, required fields and disclosures. Run deterministic arithmetic and rule fixtures; render both export formats.",
    "acceptance": "every mandatory check passes on the exact candidate version. A model’s confidence or pass verdict cannot override a failed deterministic check.",
    "sourceExactText": "EDP-006  Mechanical validation  [R1 · Must] Validate schemas, source locators, dates, scope, numeric extraction, rights records, required fields and disclosures. Run deterministic arithmetic and rule fixtures; render both export formats. Accept: every mandatory check passes on the exact candidate version. A model’s confidence or pass verdict cannot override a failed deterministic check.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:328",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "EDP-007",
    "title": "Publication manifest",
    "release": "R1",
    "priority": "Must",
    "exactText": "Bind evidence, separate reviews, risk/scope, rights and test results to immutable content, source, model/prompt and policy versions. The publisher rechecks hashes, status and freshness atomically at release.",
    "acceptance": "edits, expired evidence, failed tests or a changed policy invalidate eligibility and return the item to review; no per-item human approval is required.",
    "sourceExactText": "EDP-007  Publication manifest  [R1 · Must] Bind evidence, separate reviews, risk/scope, rights and test results to immutable content, source, model/prompt and policy versions. The publisher rechecks hashes, status and freshness atomically at release. Accept: edits, expired evidence, failed tests or a changed policy invalidate eligibility and return the item to review; no per-item human approval is required.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:332",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "EDP-008",
    "title": "Transparent public status",
    "release": "R1",
    "priority": "Must",
    "exactText": "Show “AI drafted and reviewed; not reviewed by a Nigerian legal, tax or sector specialist”, source-check date, scope and material limitations on detail pages and exports. Distinguish business drafts from general guidance.",
    "acceptance": "no “lawyer approved”, “professionally verified”, “guaranteed compliant” or equivalent claim without actual supporting review.",
    "sourceExactText": "EDP-008  Transparent public status  [R1 · Must] Show “AI drafted and reviewed; not reviewed by a Nigerian legal, tax or sector specialist”, source-check date, scope and material limitations on detail pages and exports. Distinguish business drafts from general guidance. Accept: no “lawyer approved”, “professionally verified”, “guaranteed compliant” or equivalent claim without actual supporting review.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:333",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "EDP-009",
    "title": "Least privilege automation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Drafters/reviewers cannot publish or alter policy. A bounded publisher service may release only eligible manifests; it cannot access private customer drafts, change prices, send filings or move money. Retrieval uses allowlisted official sources and isolates downloaded text as untrusted data.",
    "acceptance": "injection, forged manifests and direct publish attempts fail and are logged.",
    "sourceExactText": "EDP-009  Least privilege automation  [R1 · Must] Drafters/reviewers cannot publish or alter policy. A bounded publisher service may release only eligible manifests; it cannot access private customer drafts, change prices, send filings or move money. Retrieval uses allowlisted official sources and isolates downloaded text as untrusted data. Accept: injection, forged manifests and direct publish attempts fail and are logged.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:334",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "EDP-010",
    "title": "Editorial evaluation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Maintain 60 editorial cases separate from 60 customer AI cases and 80 rule scenarios. Include fake/misquoted citations, conflicting dates, missing text, omitted exceptions, wrong jurisdiction, unsafe clauses, injection and stale sources. Expected publish/hold outcomes need source excerpts or deterministic failure conditions.",
    "acceptance": "zero critical false publications and at least 95% overall; no claim of a legal-accuracy percentage.",
    "sourceExactText": "EDP-010  Editorial evaluation  [R1 · Must] Maintain 60 editorial cases separate from 60 customer AI cases and 80 rule scenarios. Include fake/misquoted citations, conflicting dates, missing text, omitted exceptions, wrong jurisdiction, unsafe clauses, injection and stale sources. Expected publish/hold outcomes need source excerpts or deterministic failure conditions. Accept: zero critical false publications and at least 95% overall; no claim of a legal-accuracy percentage.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:335",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "EDP-011",
    "title": "Monitoring and correction",
    "release": "R1",
    "priority": "Must",
    "exactText": "Check sources daily and re-review high-impact content monthly, other content quarterly, or immediately after material change/error. Suspend affected rules, stop new statutory reminders, flag old assessments/tasks and re-run all gates. Log the change and notify affected users when material.",
    "acceptance": "withdrawal reaches search, caches, downloads and checker; past customer files are never silently rewritten.",
    "sourceExactText": "EDP-011  Monitoring and correction  [R1 · Must] Check sources daily and re-review high-impact content monthly, other content quarterly, or immediately after material change/error. Suspend affected rules, stop new statutory reminders, flag old assessments/tasks and re-run all gates. Log the change and notify affected users when material. Accept: withdrawal reaches search, caches, downloads and checker; past customer files are never silently rewritten.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:336",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "EDP-012",
    "title": "Holds and accountability",
    "release": "R1",
    "priority": "Must",
    "exactText": "Missing evidence, conflicting reviews or provider failure leaves an item held; elapsed time never clears it. Retry with new evidence/configuration or narrow and recheck scope; otherwise keep it unavailable and show an official route. The content owner monitors queues, rights and corrections; specialist review is optional when later available, not a launch dependency.",
    "acceptance": "owners cannot waive a failed mandatory gate.",
    "sourceExactText": "EDP-012  Holds and accountability  [R1 · Must] Missing evidence, conflicting reviews or provider failure leaves an item held; elapsed time never clears it. Retry with new evidence/configuration or narrow and recheck scope; otherwise keep it unavailable and show an official route. The content owner monitors queues, rights and corrections; specialist review is optional when later available, not a launch dependency. Accept: owners cannot waive a failed mandatory gate.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:337",
    "owner": "Editorial engineering / independent QA",
    "dependencies": [
      "source/rights registry",
      "separate AI identities/runs",
      "publisher credential",
      "publication policy"
    ]
  },
  {
    "id": "OPS-001",
    "title": "Separated environments",
    "release": "R1",
    "priority": "Must",
    "exactText": "Use development, staging and production with distinct databases, storage namespaces/buckets, identity instances, PSP modes and secrets.",
    "acceptance": "no live personal data is seeded into dev; integration tests cannot charge production accounts.",
    "sourceExactText": "OPS-001  Separated environments  [R1 · Must] Use development, staging and production with distinct databases, storage namespaces/buckets, identity instances, PSP modes and secrets. Accept: no live personal data is seeded into dev; integration tests cannot charge production accounts.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:360",
    "owner": "Infrastructure / operations QA",
    "dependencies": [
      "Replit-owned environment",
      "provider configuration",
      "deployment decisions"
    ]
  },
  {
    "id": "OPS-002",
    "title": "Request and worker separation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Propose Replit Autoscale for the web/API and a Reserved VM for the queue worker.",
    "acceptance": "export, reminder and reconciliation jobs survive web-app scale-down and worker restarts. Deployment behaviour must be proven, not assumed. [S10–S11]",
    "sourceExactText": "OPS-002  Request and worker separation  [R1 · Must] Propose Replit Autoscale for the web/API and a Reserved VM for the queue worker. Accept: export, reminder and reconciliation jobs survive web-app scale-down and worker restarts. Deployment behaviour must be proven, not assumed. [S10–S11]",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:361",
    "owner": "Infrastructure / operations QA",
    "dependencies": [
      "Replit-owned environment",
      "provider configuration",
      "deployment decisions"
    ]
  },
  {
    "id": "OPS-003",
    "title": "Controlled schema deployment",
    "release": "R1",
    "priority": "Must",
    "exactText": "Review migration SQL and test against a production-shaped staging database. Replit’s documented schema publishing has limits for functions, grants and other objects, so validate ORM and queue migrations explicitly.",
    "acceptance": "one authorised migration owner; no competing automatic schema-push paths. [S12]",
    "sourceExactText": "OPS-003  Controlled schema deployment  [R1 · Must] Review migration SQL and test against a production-shaped staging database. Replit’s documented schema publishing has limits for functions, grants and other objects, so validate ORM and queue migrations explicitly. Accept: one authorised migration owner; no competing automatic schema-push paths. [S12]",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:362",
    "owner": "Infrastructure / operations QA",
    "dependencies": [
      "Replit-owned environment",
      "provider configuration",
      "deployment decisions"
    ]
  },
  {
    "id": "OPS-004",
    "title": "Secrets and account ownership",
    "release": "R1",
    "priority": "Must",
    "exactText": "Keep secrets in environment-specific secret stores and managed provider accounts owned by Valo.",
    "acceptance": "no keys in prompts, browser bundles, commits or screenshots; rotation and emergency revocation are rehearsed.",
    "sourceExactText": "OPS-004  Secrets and account ownership  [R1 · Must] Keep secrets in environment-specific secret stores and managed provider accounts owned by Valo. Accept: no keys in prompts, browser bundles, commits or screenshots; rotation and emergency revocation are rehearsed.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:363",
    "owner": "Infrastructure / operations QA",
    "dependencies": [
      "Replit-owned environment",
      "provider configuration",
      "deployment decisions"
    ]
  },
  {
    "id": "OPS-005",
    "title": "Supply-chain and code review",
    "release": "R1",
    "priority": "Must",
    "exactText": "Use a private Git repository, protected main branch, CI checks, dependency/secret scans and human approval for sensitive changes.",
    "acceptance": "the release identifies commit, migration, content/rule versions and known issues.",
    "sourceExactText": "OPS-005  Supply-chain and code review  [R1 · Must] Use a private Git repository, protected main branch, CI checks, dependency/secret scans and human approval for sensitive changes. Accept: the release identifies commit, migration, content/rule versions and known issues.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:364",
    "owner": "Infrastructure / operations QA",
    "dependencies": [
      "Replit-owned environment",
      "provider configuration",
      "deployment decisions"
    ]
  },
  {
    "id": "OPS-006",
    "title": "Hosting and data geography",
    "release": "R1",
    "priority": "Must",
    "exactText": "Record actual hosting and processor regions before live data. Replit documentation describes US hosting by default and an enterprise EU request option; obtain the relevant transfer assessment and contracts.",
    "acceptance": "no claim that Nigerian customer data stays in Nigeria without proof. [S10]",
    "sourceExactText": "OPS-006  Hosting and data geography  [R1 · Must] Record actual hosting and processor regions before live data. Replit documentation describes US hosting by default and an enterprise EU request option; obtain the relevant transfer assessment and contracts. Accept: no claim that Nigerian customer data stays in Nigeria without proof. [S10]",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:365",
    "owner": "Infrastructure / operations QA",
    "dependencies": [
      "Replit-owned environment",
      "provider configuration",
      "deployment decisions"
    ]
  },
  {
    "id": "OPS-007",
    "title": "Production compatibility spike",
    "release": "R1",
    "priority": "Must",
    "exactText": "Prove identity callbacks, private storage, background queue, browser binaries, DB connection limits, backup/restore, domains and outbound provider calls.",
    "acceptance": "failures produce an approved architecture change before core implementation scales.",
    "sourceExactText": "OPS-007  Production compatibility spike  [R1 · Must] Prove identity callbacks, private storage, background queue, browser binaries, DB connection limits, backup/restore, domains and outbound provider calls. Accept: failures produce an approved architecture change before core implementation scales.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:366",
    "owner": "Infrastructure / operations QA",
    "dependencies": [
      "Replit-owned environment",
      "provider configuration",
      "deployment decisions"
    ]
  },
  {
    "id": "OPS-008",
    "title": "Safe rollback",
    "release": "R1",
    "priority": "Must",
    "exactText": "Use backward-compatible database changes, versioned assets and reversible feature flags.",
    "acceptance": "deploy the previous application version safely or restore through a tested recovery plan; irreversible migrations require a separate approved runbook.",
    "sourceExactText": "OPS-008  Safe rollback  [R1 · Must] Use backward-compatible database changes, versioned assets and reversible feature flags. Accept: deploy the previous application version safely or restore through a tested recovery plan; irreversible migrations require a separate approved runbook.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:367",
    "owner": "Infrastructure / operations QA",
    "dependencies": [
      "Replit-owned environment",
      "provider configuration",
      "deployment decisions"
    ]
  },
  {
    "id": "SEC-001",
    "title": "Object-level authorisation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Validate tenant membership and specific resource permission in every API, background job, search query and download.",
    "acceptance": "automated negative tests enumerate cross-tenant ID substitutions across all private entity types.",
    "sourceExactText": "SEC-001  Object-level authorisation  [R1 · Must] Validate tenant membership and specific resource permission in every API, background job, search query and download. Accept: automated negative tests enumerate cross-tenant ID substitutions across all private entity types.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:441",
    "owner": "Security / independent assessor",
    "dependencies": [
      "all private surfaces",
      "least-privilege roles",
      "staging environment"
    ]
  },
  {
    "id": "SEC-002",
    "title": "Transport, storage and secrets",
    "release": "R1",
    "priority": "Must",
    "exactText": "Require HTTPS, secure cookies, managed encryption at rest and protected secrets.",
    "acceptance": "no secret-bearing client bundle; sensitive backups and storage objects are not publicly addressable; rotation tests pass.",
    "sourceExactText": "SEC-002  Transport, storage and secrets  [R1 · Must] Require HTTPS, secure cookies, managed encryption at rest and protected secrets. Accept: no secret-bearing client bundle; sensitive backups and storage objects are not publicly addressable; rotation tests pass.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:442",
    "owner": "Security / independent assessor",
    "dependencies": [
      "all private surfaces",
      "least-privilege roles",
      "staging environment"
    ]
  },
  {
    "id": "SEC-003",
    "title": "Input and output controls",
    "release": "R1",
    "priority": "Must",
    "exactText": "Use parameterised database access, schema validation, sanitised rich text and a restrictive content-security policy. Apply CSRF protection to cookie-authenticated mutations.",
    "acceptance": "stored/reflected XSS, injection and cross-site mutation tests pass.",
    "sourceExactText": "SEC-003  Input and output controls  [R1 · Must] Use parameterised database access, schema validation, sanitised rich text and a restrictive content-security policy. Apply CSRF protection to cookie-authenticated mutations. Accept: stored/reflected XSS, injection and cross-site mutation tests pass.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:443",
    "owner": "Security / independent assessor",
    "dependencies": [
      "all private surfaces",
      "least-privilege roles",
      "staging environment"
    ]
  },
  {
    "id": "SEC-004",
    "title": "Renderer and network isolation",
    "release": "R1",
    "priority": "Must",
    "exactText": "Render only approved templates and sanitised content; disable remote network access in the PDF worker unless explicitly allowlisted.",
    "acceptance": "document text cannot fetch cloud metadata, local files, private URLs or execute embedded script/macros.",
    "sourceExactText": "SEC-004  Renderer and network isolation  [R1 · Must] Render only approved templates and sanitised content; disable remote network access in the PDF worker unless explicitly allowlisted. Accept: document text cannot fetch cloud metadata, local files, private URLs or execute embedded script/macros.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:444",
    "owner": "Security / independent assessor",
    "dependencies": [
      "all private surfaces",
      "least-privilege roles",
      "staging environment"
    ]
  },
  {
    "id": "SEC-005",
    "title": "Abuse and quotas",
    "release": "R1",
    "priority": "Must",
    "exactText": "Start with configurable ceilings: anonymous reads 60/min/IP, authenticated reads 120/min/user, AI 5/min, checkout and export creation 10/min/user plus account limits.",
    "acceptance": "legitimate errors explain recovery; distributed abuse and financial-cost spikes trigger alerts.",
    "sourceExactText": "SEC-005  Abuse and quotas  [R1 · Must] Start with configurable ceilings: anonymous reads 60/min/IP, authenticated reads 120/min/user, AI 5/min, checkout and export creation 10/min/user plus account limits. Accept: legitimate errors explain recovery; distributed abuse and financial-cost spikes trigger alerts.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:445",
    "owner": "Security / independent assessor",
    "dependencies": [
      "all private surfaces",
      "least-privilege roles",
      "staging environment"
    ]
  },
  {
    "id": "SEC-006",
    "title": "Privileged operations",
    "release": "R1",
    "priority": "Must",
    "exactText": "Require staff MFA, least privilege and time-bounded break-glass access. Isolate drafting, review and publisher service credentials.",
    "acceptance": "no actor bypasses content gates or accesses private drafts without permission; automation cannot grant roles, change policy or suppress its own audit evidence.",
    "sourceExactText": "SEC-006  Privileged operations  [R1 · Must] Require staff MFA, least privilege and time-bounded break-glass access. Isolate drafting, review and publisher service credentials. Accept: no actor bypasses content gates or accesses private drafts without permission; automation cannot grant roles, change policy or suppress its own audit evidence.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:446",
    "owner": "Security / independent assessor",
    "dependencies": [
      "all private surfaces",
      "least-privilege roles",
      "staging environment"
    ]
  },
  {
    "id": "SEC-007",
    "title": "Vulnerability management",
    "release": "R1",
    "priority": "Must",
    "exactText": "Scan code, dependencies and secrets on each merge; independently review before public launch.",
    "acceptance": "no open critical or high exploitable issues in launch paths, with lower-severity exceptions owned and time-bound.",
    "sourceExactText": "SEC-007  Vulnerability management  [R1 · Must] Scan code, dependencies and secrets on each merge; independently review before public launch. Accept: no open critical or high exploitable issues in launch paths, with lower-severity exceptions owned and time-bound.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:447",
    "owner": "Security / independent assessor",
    "dependencies": [
      "all private surfaces",
      "least-privilege roles",
      "staging environment"
    ]
  },
  {
    "id": "SEC-008",
    "title": "Monitoring and response",
    "release": "R1",
    "priority": "Must",
    "exactText": "Alert on repeated denied access, bulk exports, role changes, signature failures and unusual payment/AI activity.",
    "acceptance": "a tabletop incident demonstrates containment, evidence preservation, privacy escalation and customer communications.",
    "sourceExactText": "SEC-008  Monitoring and response  [R1 · Must] Alert on repeated denied access, bulk exports, role changes, signature failures and unusual payment/AI activity. Accept: a tabletop incident demonstrates containment, evidence preservation, privacy escalation and customer communications.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:448",
    "owner": "Security / independent assessor",
    "dependencies": [
      "all private surfaces",
      "least-privilege roles",
      "staging environment"
    ]
  },
  {
    "id": "PRV-001",
    "title": "Processing inventory",
    "release": "R1",
    "priority": "Must",
    "exactText": "Record purpose, lawful basis, data categories, subjects, recipients, retention and processors for accounts, drafts, orders, AI and support.",
    "acceptance": "the privacy notice reflects actual production processing and optional consent is not bundled with required service terms.",
    "sourceExactText": "PRV-001  Processing inventory  [R1 · Must] Record purpose, lawful basis, data categories, subjects, recipients, retention and processors for accounts, drafts, orders, AI and support. Accept: the privacy notice reflects actual production processing and optional consent is not bundled with required service terms.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:455",
    "owner": "Privacy owner / lifecycle QA",
    "dependencies": [
      "retrieved applicable authority text",
      "actual provider contracts",
      "accountable owner"
    ]
  },
  {
    "id": "PRV-002",
    "title": "Processors and transfers",
    "release": "R1",
    "priority": "Must",
    "exactText": "Approve provider contracts, subprocessors, actual storage/processing regions and data settings before live data.",
    "acceptance": "documented review covers Replit, identity, email, payments, AI and monitoring; no unverified “zero retention” promise. [S10, S18]",
    "sourceExactText": "PRV-002  Processors and transfers  [R1 · Must] Approve provider contracts, subprocessors, actual storage/processing regions and data settings before live data. Accept: documented review covers Replit, identity, email, payments, AI and monitoring; no unverified “zero retention” promise. [S10, S18]",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:456",
    "owner": "Privacy owner / lifecycle QA",
    "dependencies": [
      "retrieved applicable authority text",
      "actual provider contracts",
      "accountable owner"
    ]
  },
  {
    "id": "PRV-003",
    "title": "Individual rights and incidents",
    "release": "R1",
    "priority": "Must",
    "exactText": "Provide request verification, correction/export/deletion and legal-hold handling.",
    "acceptance": "a test request traverses all systems. Notification triggers/deadlines must have retrieved statutory evidence and AI checks; the privacy owner owns incident decisions. Uncertainty prompts immediate assessment and authority contact, not an invented deadline.",
    "sourceExactText": "PRV-003  Individual rights and incidents  [R1 · Must] Provide request verification, correction/export/deletion and legal-hold handling. Accept: a test request traverses all systems. Notification triggers/deadlines must have retrieved statutory evidence and AI checks; the privacy owner owns incident decisions. Uncertainty prompts immediate assessment and authority contact, not an invented deadline.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:457",
    "owner": "Privacy owner / lifecycle QA",
    "dependencies": [
      "retrieved applicable authority text",
      "actual provider contracts",
      "accountable owner"
    ]
  },
  {
    "id": "NFR-001",
    "title": "Availability",
    "release": "R1",
    "priority": "Acceptance target",
    "exactText": "99.5% monthly availability for core web/API journeys; separate status for AI and PSP dependencies.",
    "acceptance": "External synthetic checks; incident log; documented denominator and planned-maintenance treatment.",
    "sourceExactText": "NFR-001 / Availability | 99.5% monthly availability for core web/API journeys; separate status for AI and PSP dependencies. | External synthetic checks; incident log; documented denominator and planned-maintenance treatment.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:473",
    "owner": "QA / operations",
    "dependencies": [
      "deployed staging",
      "load generators",
      "manual accessibility/device review"
    ]
  },
  {
    "id": "NFR-002",
    "title": "Public performance",
    "release": "R1",
    "priority": "Acceptance target",
    "exactText": "Mobile p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 on representative supported devices/connections.",
    "acceptance": "Pre-launch lab checks plus real-user measurements when a sufficient sample exists; disclose sample size.",
    "sourceExactText": "NFR-002 / Public performance | Mobile p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 on representative supported devices/connections. | Pre-launch lab checks plus real-user measurements when a sufficient sample exists; disclose sample size.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:474",
    "owner": "QA / operations",
    "dependencies": [
      "deployed staging",
      "load generators",
      "manual accessibility/device review"
    ]
  },
  {
    "id": "NFR-003",
    "title": "API and search",
    "release": "R1",
    "priority": "Acceptance target",
    "exactText": "p95 ≤1s for ordinary authenticated requests and catalogue search at 20 requests/s for 30 minutes; <1% unexpected 5xx.",
    "acceptance": "Reproducible test excluding AI/render duration but including application authorisation and database work.",
    "sourceExactText": "NFR-003 / API and search | p95 ≤1s for ordinary authenticated requests and catalogue search at 20 requests/s for 30 minutes; <1% unexpected 5xx. | Reproducible test excluding AI/render duration but including application authorisation and database work.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:475",
    "owner": "QA / operations",
    "dependencies": [
      "deployed staging",
      "load generators",
      "manual accessibility/device review"
    ]
  },
  {
    "id": "NFR-004",
    "title": "Export and AI",
    "release": "R1",
    "priority": "Acceptance target",
    "exactText": "Typical ≤10-page DOCX p95 ≤10s; PDF ≤30s under five parallel jobs. AI draft p95 ≤45s under tested provider conditions.",
    "acceptance": "Job telemetry, timeout/failure cases and content-format comparison; queue time included.",
    "sourceExactText": "NFR-004 / Export and AI | Typical ≤10-page DOCX p95 ≤10s; PDF ≤30s under five parallel jobs. AI draft p95 ≤45s under tested provider conditions. | Job telemetry, timeout/failure cases and content-format comparison; queue time included.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:476",
    "owner": "QA / operations",
    "dependencies": [
      "deployed staging",
      "load generators",
      "manual accessibility/device review"
    ]
  },
  {
    "id": "NFR-005",
    "title": "Recovery",
    "release": "R1",
    "priority": "Acceptance target",
    "exactText": "Database RPO ≤1h and core-service RTO ≤4h; regenerable export objects RPO ≤24h.",
    "acceptance": "Restore into isolated environment, verify data/permissions and replay reconciliation; provider backup capability proved.",
    "sourceExactText": "NFR-005 / Recovery | Database RPO ≤1h and core-service RTO ≤4h; regenerable export objects RPO ≤24h. | Restore into isolated environment, verify data/permissions and replay reconciliation; provider backup capability proved.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:477",
    "owner": "QA / operations",
    "dependencies": [
      "deployed staging",
      "load generators",
      "manual accessibility/device review"
    ]
  },
  {
    "id": "NFR-006",
    "title": "Accessibility",
    "release": "R1",
    "priority": "Acceptance target",
    "exactText": "WCAG 2.2 AA target across critical flows; keyboard, visible focus, screen-reader labels, errors and reflow.",
    "acceptance": "Automated checks plus manual keyboard and assistive-technology review. [S20]",
    "sourceExactText": "NFR-006 / Accessibility | WCAG 2.2 AA target across critical flows; keyboard, visible focus, screen-reader labels, errors and reflow. | Automated checks plus manual keyboard and assistive-technology review. [S20]",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:478",
    "owner": "QA / operations",
    "dependencies": [
      "deployed staging",
      "load generators",
      "manual accessibility/device review"
    ]
  },
  {
    "id": "NFR-007",
    "title": "Browsers and mobile",
    "release": "R1",
    "priority": "Acceptance target",
    "exactText": "Latest and preceding major Chrome, Edge, Firefox and Safari at release; Android Chrome/iOS Safari; no horizontal page overflow at 360px.",
    "acceptance": "Document supported-version matrix, real-device checks and touch interaction tests.",
    "sourceExactText": "NFR-007 / Browsers and mobile | Latest and preceding major Chrome, Edge, Firefox and Safari at release; Android Chrome/iOS Safari; no horizontal page overflow at 360px. | Document supported-version matrix, real-device checks and touch interaction tests.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:479",
    "owner": "QA / operations",
    "dependencies": [
      "deployed staging",
      "load generators",
      "manual accessibility/device review"
    ]
  },
  {
    "id": "NFR-008",
    "title": "Localisation",
    "release": "R1",
    "priority": "Acceptance target",
    "exactText": "English at launch; NGN formatting; Africa/Lagos user-facing deadlines; UTC event storage and unambiguous dates.",
    "acceptance": "Timezone-boundary and naira/export glyph tests; unknown dates remain unset.",
    "sourceExactText": "NFR-008 / Localisation | English at launch; NGN formatting; Africa/Lagos user-facing deadlines; UTC event storage and unambiguous dates. | Timezone-boundary and naira/export glyph tests; unknown dates remain unset.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:480",
    "owner": "QA / operations",
    "dependencies": [
      "deployed staging",
      "load generators",
      "manual accessibility/device review"
    ]
  },
  {
    "id": "NFR-009",
    "title": "Reliability",
    "release": "R1",
    "priority": "Acceptance target",
    "exactText": "No silent draft loss, duplicated entitlement or unrecorded critical state transition; bounded retriable jobs.",
    "acceptance": "Concurrency, network-loss, webhook-race, worker-crash and database-failure tests.",
    "sourceExactText": "NFR-009 / Reliability | No silent draft loss, duplicated entitlement or unrecorded critical state transition; bounded retriable jobs. | Concurrency, network-loss, webhook-race, worker-crash and database-failure tests.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:481",
    "owner": "QA / operations",
    "dependencies": [
      "deployed staging",
      "load generators",
      "manual accessibility/device review"
    ]
  },
  {
    "id": "NFR-010",
    "title": "Operability",
    "release": "R1",
    "priority": "Acceptance target",
    "exactText": "All critical journeys instrumented; alerts have owners and runbooks; no private document text in logs.",
    "acceptance": "Synthetic failures verify alerts, redaction and support escalation.",
    "sourceExactText": "NFR-010 / Operability | All critical journeys instrumented; alerts have owners and runbooks; no private document text in logs. | Synthetic failures verify alerts, redaction and support escalation.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:482",
    "owner": "QA / operations",
    "dependencies": [
      "deployed staging",
      "load generators",
      "manual accessibility/device review"
    ]
  },
  {
    "id": "NFR-011",
    "title": "Maintainability",
    "release": "R1",
    "priority": "Acceptance target",
    "exactText": "Typed contracts, lint/type checks, reviewed migrations and architectural boundaries; 80% branch coverage in payment/auth/rules modules.",
    "acceptance": "CI report plus scenario tests; coverage percentage never substitutes for negative security cases.",
    "sourceExactText": "NFR-011 / Maintainability | Typed contracts, lint/type checks, reviewed migrations and architectural boundaries; 80% branch coverage in payment/auth/rules modules. | CI report plus scenario tests; coverage percentage never substitutes for negative security cases.",
    "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:483",
    "owner": "QA / operations",
    "dependencies": [
      "deployed staging",
      "load generators",
      "manual accessibility/device review"
    ]
  }
] as const;
export const sourceGates = [
  {
    "id": "G0",
    "requiredEvidence": "Scope/roles and AI policy set; technical slice works; privacy/procurement issues understood; source/AI budget and risks assigned.",
    "approvers": "Product owner + technical/content leads + privacy owner."
  },
  {
    "id": "G1",
    "requiredEvidence": "Identity/tenant isolation; public/CMS foundation; 10 eligible templates and 10 entries; publisher allows valid manifests and blocks failures.",
    "approvers": "Technical lead + QA + content lead."
  },
  {
    "id": "G2",
    "requiredEvidence": "Document/checker alpha; 12 guided schemas; saved exports; evidence-based explanations/gaps; 40 editorial cases.",
    "approvers": "Product owner + engineering + content operations owner."
  },
  {
    "id": "G3",
    "requiredEvidence": "R1 journeys, safe payments, 60 customer AI cases, 80 rule scenarios and 60 editorial cases; target content eligible; privacy/support ready.",
    "approvers": "Engineering + QA + content/privacy owners."
  },
  {
    "id": "G4",
    "requiredEvidence": "Beta results; reconciled transactions; independent security assessment; accessibility; restore/correction drills; commercial decisions and current manifests.",
    "approvers": "Product owner + technical lead + security/privacy + finance/content leads."
  },
  {
    "id": "G5",
    "requiredEvidence": "Approved build, safe migrations/rollback, live smoke tests, staffed support, healthy monitoring and no failed mandatory content gates.",
    "approvers": "Product owner + technical/privacy/security owners; AI manifests evidence content readiness."
  }
] as const;

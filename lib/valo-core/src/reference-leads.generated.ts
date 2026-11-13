// Generated from retained original TRD/roadmap by sync-final-context.ts. Discovery only.
export const finalSourceContext = {
  "sourceHashes": {
    "docs/specification/VALO-TRD-001-v1.1.txt": "cc1a9f021b1d5c33288a25d13fa10e9eb45f37e707fd4ae9c4c539b61dace9d1",
    "docs/specification/VALO-ROADMAP-001-v1.1.txt": "0b8db130845f36ce9828aafbebf1a292c9734fab1ba3518fa6469ae1ce4210f4"
  },
  "roadmapSections": [
    {
      "id": "ROADMAP-02",
      "title": "PROPOSED SEQUENCE",
      "sourcePath": "docs/specification/VALO-ROADMAP-001-v1.1.txt",
      "exactContract": "02 / PROPOSED SEQUENCE\nMaster timeline and release map\nPHASE / WINDOW | OUTCOME | GATE\nP0 · Weeks 1–2 | Approve team, scope, architecture and AI policy; prove technical slice and source-to-review pipeline; measure initial content throughput. | G0: build-ready baseline\nP1 · Weeks 3–6 | Public site, identity, workspace, CMS, AI review/publisher gates and initial eligible content. | G1: secure foundation\nP2 · Weeks 7–10 | Template catalogue, guided editor/export, compliance hub, deterministic checker and assessment history. | G2: core product alpha\nP3 · Weeks 11–14 | Real checkout/entitlements, bounded AI drafting, reminders, service enquiries, complete R1 content and admin operations. | G3: beta-ready release\nP4 · Weeks 15–18 | Real-user beta, payment/refund reconciliation, AI content audit, security/accessibility and recovery exercises. | G4: commercial readiness\nP5 · Weeks 19–20 | Remediation, operational rehearsal, approved production release and staged public rollout. | G5: accepted R1 launch\nR2 · Weeks 21–28 | Improve retention; deepen content, team access, provider verification and quote/appointment requests. | Demand and operational gates\nR3 · Months 8–12 | Selective paid bookings, further regulated sectors and justified integrations; no automatic commitment to every feature. | Separate risk and commercial approval\n\nIllustrative calendar only\nA hypothetical kickoff on Monday, 16 November 2026 places P0 on 16–29 November; P1 on 30 November–27 December; P2 on 28 December–24 January 2027; P3 on 25 January–21 February; beta on 22 February–21 March; and launch preparation on 22 March–4 April. The final business day of that baseline is 2 April 2027. R2 would run 5 April–30 May.\nThis calendar assumes uninterrupted capacity, including December/January. Rebaseline against actual team availability, procurement, source acquisition and measured AI pipeline throughput. The relative-week sequence is the primary plan; it is not an announced launch date.\nProtected scope boundary\nR1 includes all three document modes and real commercial operations. It excludes recurring billing, team collaboration, evidence-file uploads, electronic signatures, automated government submissions, live professional booking payments and a comprehensive national legal determination. Service enquiry routing is real; an enquiry is not a booking.",
      "sha256": "750ebf1f419bf2008ca3a01c81d24a0eb426958cc979267c6282136d4c94c4ec",
      "sourceStartLine": 67,
      "status": "planning_assumption_not_accepted"
    },
    {
      "id": "ROADMAP-03",
      "title": "SPRINTS 1–5",
      "sourcePath": "docs/specification/VALO-ROADMAP-001-v1.1.txt",
      "exactContract": "03 / SPRINTS 1–5\nSprint backlog · foundation and core\nSprint 1 · Weeks 1–2 | De-risk the build\nWork: resolve D01–D07; inspect any demo; establish Git/staging; prove identity, storage, export worker, migrations and restore. Configure AI drafting/review roles, allowed sources, rights register and publisher policy; measure an initial content batch. Owners: product, technical/content leads and privacy owner. Exit: G0, working technical slice and scoped pipeline plan; no specialist recruitment dependency. Trace: OPS-001–008; PRV-001–002; EDP-001–004/009.\nSprint 2 · Weeks 3–4 | Build the public and account foundation\nWork: public design/navigation, sign-in, workspace and profile. Build AI drafting/review jobs and publication states with distinct service permissions. Retrieve real source text and draft the early catalogue. Owners: engineering, designer and content operations lead. Exit: tenant-isolated saved profiles and working source-to-candidate evidence flow. Trace: WEB-001–004; IAM-001–003; PRO-001–003; ADM-001–003; EDP-002–004/009.\nSprint 3 · Weeks 5–6 | Make content discoverable and safe\nWork: search, previews, source/jurisdiction records, publisher gates and audits. Finish 10 AI-cleared templates and 10 guidance entries; build an initial 20 editorial test cases. Exit: G1; a valid manifest publishes automatically, failed/forged evidence is held and two businesses remain isolated. Trace: DOC-001–009; CMP-001–004; ADM-009; SEC-001–003; EDP-005–010.\nSprint 4 · Weeks 7–8 | Deliver the first complete document flow\nWork: canonical model, revision-safe saves, six guided editors, private DOCX/PDF jobs and typed questionnaire/rules. Exercise high-impact template gates and begin PSP onboarding. Exit: a customer completes, exports and reopens a real guided document; unsupported clauses cannot pass publishing. Trace: EDT-001–010; RUL-001–003; PAY-001–002; EDP-005–007.\nSprint 5 · Weeks 9–10 | Connect documents to requirements\nWork: complete 12 guided editors, guidance hub, explainable checker and assessment history. Reach 20 AI-cleared templates, 20 guidance entries, six guide candidates, 40 rule scenarios and 40 editorial cases. Exit: G2; J1/J2/J6 work with actual storage, source-backed fixtures and visible held/gap states. Trace: CMP/RUL; WRK-001–002; UAT-01/03/05/06/07.",
      "sha256": "a28586616dd4dae64288509983f29312267fc9c1dd64d984d545fc7e1da03e4b",
      "sourceStartLine": 85,
      "status": "planning_assumption_not_accepted"
    },
    {
      "id": "ROADMAP-04",
      "title": "SPRINTS 6–10",
      "sourcePath": "docs/specification/VALO-ROADMAP-001-v1.1.txt",
      "exactContract": "04 / SPRINTS 6–10\nSprint backlog · commerce to launch\nSprint 6 · Weeks 11–12 | Activate commerce and bounded AI\nWork: checkout, webhooks, atomic entitlements, receipts and history. Integrate four customer AI tasks with validation, privacy, arithmetic and quotas; keep customer permissions separate from the editorial pipeline. Owners: engineering/QA; AI review plus content owner monitors evidence. Exit: sandbox purchase/refund and AI fallback pass. Trace: PAY-001–010; AI-001–009; EDP-009.\nSprint 7 · Weeks 13–14 | Complete the beta product\nWork: reconciliation, reminders, enquiries, privacy requests and alerts. Target 40 AI-cleared templates, 30 guidance entries, 12 guides and six deeper packs. Complete three separate suites: 80 rule scenarios, 60 customer AI cases and 60 editorial cases. Exit: G3; all content gates pass, no critical defect remains and any inventory shortfall has an approved scope/schedule response. Trace: WRK/SRV/ADM/PRV; EDP-001–012; UAT-02/04/07/09/10.\nSprint 8 · Weeks 15–16 | Controlled beta and independent assessment\nWork: invite a small first cohort, then expand toward 30 businesses across six sectors; include at least five outside the initially prioritised locations. Run supervised tasks, authorised low-value live purchases/refunds, security review, accessibility testing and export compatibility checks. Exit: supported beta with measured task outcomes and a prioritised defect register; no unresolved critical security or false-legal-claim issue. Trace: UAT-01–10; SEC-007; NFR-006–007.\nSprint 9 · Weeks 17–18 | Stabilise and rehearse operations\nWork: resolve beta issues; test payment races, load, restore and deletion; reconcile transactions; rehearse source expiry, holds and correction notices. Obtain commercial, privacy and security operational decisions plus a complete AI publication manifest. Exit: G4; blockers closed and support/content owners ready. No professional content signature is required. Trace: NFR-001–011; OPS-008; PRV-003; PAY-007–008; EDP-007/011–012.\nSprint 10 · Weeks 19–20 | Release with controls\nWork: freeze scope, verify backups, deploy reviewed migrations/build, smoke-test and open traffic gradually. Monitor payments, queues, content reports and source freshness. Exit: G5 product/technical/privacy/security operational acceptance plus passing AI publication evidence; record residual issues. Subsequent eligible content updates publish automatically under the approved policy.\nPROTECT THE RELEASE EVIDENCE  AI can draft, review and publish eligible content. It does not replace customer testing, payment integrity, technical security assessment or recovery evidence. Keep these operational gates separate from the automated content pipeline.",
      "sha256": "706d1720de516fdc5b3bbda1795d22c7cc8bee625d4b8d32af3764d6fad0c223",
      "sourceStartLine": 98,
      "status": "planning_assumption_not_accepted"
    },
    {
      "id": "ROADMAP-05",
      "title": "PARALLEL WORKSTREAM",
      "sourcePath": "docs/specification/VALO-ROADMAP-001-v1.1.txt",
      "exactContract": "05 / PARALLEL WORKSTREAM\nContent and coverage roadmap\nContent starts in Week 1 beside engineering. The critical path is authoritative evidence, rights clearance and a tested AI drafting/review/publishing pipeline, not access to specialist reviewers. “AI-cleared” below means all configured publication gates passed; it never means professionally verified or legally certified.\nMILESTONE | CONTENT OUTPUT | PUBLICATION EVIDENCE\nW2 / pipeline defined | 40-item inventory; rights/source registers; six sectors; locations; allowed content classes; model roles and policy. | Accountable owner, AI configurations, source requirements and draft/hold/release criteria; no reviewer contracts.\nW6 / initial eligible set | 10 templates; 10 guidance entries; industry navigation; early guides; 20 editorial cases. | Separate AI findings, evidence hashes, exports and working publisher; failed items held; AI status visible.\nW10 / core alpha content | 20 templates; 20 entries; 12 guided schemas; six guide candidates; 40 rule and 40 editorial cases. | Cross-links and fixtures pass; conflicts held; local coverage gaps visible; no legal-accuracy claim.\nW14 / complete R1 set | 40 templates (12 free/28 premium); 30 entries; 12 guides; six packs; 80 rule and 60 editorial cases. | Rights, sources, enhanced AI checks and exports pass; all 60 customer AI cases evaluated separately.\nW18 / launch validation | Recheck source changes, scope, fees/deadlines, stale content and live correction handling. | Complete manifests, correction/hold log, freshness dates, withdrawal drill and user notices where material.\nR2 / proposed growth | 80 templates; 24 guided flows; 60 entries; 10 deeper packs; up to six AI-reviewed state/FCT packs. | Expand with demand and measured pipeline/maintenance capacity; each rule has sources, tests and disclosure.\n\nInitial depth and honest breadth\nInitial deeper sectors: retail/wholesale, packaged foods, restaurants/hospitality, technology/software, professional services and beauty/personal care. Prioritise Lagos, FCT and Bayelsa sources. Other businesses receive relevant AI-reviewed federal guidance with explicit state/LGA or activity-specific gaps; no specialist availability is promised.\nMaintenance is a permanent responsibility\nMonitor official sources daily and run separate AI reassessment after a material change. High-impact content is rechecked monthly; other guidance quarterly. Passing updates publish automatically; uncertainty or failed tests hold the affected item. Preserve historical versions, suspend stale recommendations/reminders and notify material corrections. These are operating targets, not statutory periods. [S01; TRD EDP-011–012]\nCounts are targets, not existing assets or evidence of quality. Do not pad them with failed items. Publish only eligible versions; the product owner must record a scope or schedule change for a shortfall. AI agreement is not professional validation. Use TRD EDP-001–012 for disclosure, source evidence and release criteria.",
      "sha256": "77a0758592482c12d7d0e73557edb0562b6e8f8ec0b7c9a972f74c04876419b0",
      "sourceStartLine": 113,
      "status": "planning_assumption_not_accepted"
    }
  ],
  "references": [
    {
      "id": "S01",
      "title": "Federal Ministry of Information and National Orientation: tax-transition guidelines, 18 June 2026",
      "url": "https://fmino.gov.ng/federal-government-issues-transition-guidelines-for-tax-acts-2025/",
      "baselineNotes": "Official transition announcement. Supports effective-date and historical-period handling; not a complete tax interpretation.",
      "category": "regulatory",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L550",
      "exactBaseline": "S01  Federal Ministry of Information and National Orientation: tax-transition guidelines, 18 June 2026\nhttps://fmino.gov.ng/federal-government-issues-transition-guidelines-for-tax-acts-2025/\nOfficial transition announcement. Supports effective-date and historical-period handling; not a complete tax interpretation.",
      "baselineSha256": "dd80c8fd36f9cb7056eb2fb042869b4290309c004f8fb011c726ccaa62f2ff34"
    },
    {
      "id": "S02",
      "title": "Nigeria Revenue Service: Nigeria Tax Administration Act, 2025",
      "url": "https://www.nrs.gov.ng/uploads/NIGERIA_TAX_ADMINISTRATION_ACT_2025_8c945071a7.pdf",
      "baselineNotes": "Official Act located and text retrieved. Page-image retrieval was unavailable; detailed provisions must be checked against the authoritative instrument before rules are approved.",
      "category": "regulatory",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L553",
      "exactBaseline": "S02  Nigeria Revenue Service: Nigeria Tax Administration Act, 2025\nhttps://www.nrs.gov.ng/uploads/NIGERIA_TAX_ADMINISTRATION_ACT_2025_8c945071a7.pdf\nOfficial Act located and text retrieved. Page-image retrieval was unavailable; detailed provisions must be checked against the authoritative instrument before rules are approved.",
      "baselineSha256": "44c59cbf0122e0e45ac97c87b294027ce729d315d73615e7203a0470ea6af70c"
    },
    {
      "id": "S03",
      "title": "Corporate Affairs Commission: company registration portal",
      "url": "https://icrp.cac.gov.ng/",
      "baselineNotes": "Official service-discovery reference, including annual-return services. Not evidence that one filing rule applies to every legal form.",
      "category": "regulatory",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L556",
      "exactBaseline": "S03  Corporate Affairs Commission: company registration portal\nhttps://icrp.cac.gov.ng/\nOfficial service-discovery reference, including annual-return services. Not evidence that one filing rule applies to every legal form.",
      "baselineSha256": "8cc55d41c069ba0ea86aafb7d73392c2184fc9e0972f35d00607448699b21173"
    },
    {
      "id": "S04",
      "title": "NDPC: Nigeria Data Protection Act, 2023",
      "url": "https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf",
      "baselineNotes": "Original baseline: official instrument located but full retrieval blocked. Obtain the authoritative text for source-grounded AI assessment before using its provisions in production.",
      "category": "regulatory",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L559",
      "exactBaseline": "S04  NDPC: Nigeria Data Protection Act, 2023\nhttps://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf\nOriginal baseline: official instrument located but full retrieval blocked. Obtain the authoritative text for source-grounded AI assessment before using its provisions in production.",
      "baselineSha256": "aa58f7a96e3f87e4955cc9cf8b8ad98bfb41424b28a597475b1df5b95852c45c"
    },
    {
      "id": "S05",
      "title": "NDPC: General Application and Implementation Directive, 2025",
      "url": "https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf",
      "baselineNotes": "Original baseline: official directive located but full retrieval blocked. Registration, audit-return and transfer applicability require source-grounded assessment; no conclusion is certified here.",
      "category": "regulatory",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L562",
      "exactBaseline": "S05  NDPC: General Application and Implementation Directive, 2025\nhttps://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf\nOriginal baseline: official directive located but full retrieval blocked. Registration, audit-return and transfer applicability require source-grounded assessment; no conclusion is certified here.",
      "baselineSha256": "5611933e9ea0bae2f7a18e4633ed4e7f79e13e8c6ef53569e31ae8188ac8a80b"
    },
    {
      "id": "S06",
      "title": "NDPC: NDP Act and GAID implementation workshop, August 2026",
      "url": "https://forms.ndpc.gov.ng/ndp-act-2023-gaid-2025-implementation-workshop/",
      "baselineNotes": "Official confirmation of the implementation framework and compliance-audit themes. Used for context, not statutory thresholds.",
      "category": "regulatory",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L565",
      "exactBaseline": "S06  NDPC: NDP Act and GAID implementation workshop, August 2026\nhttps://forms.ndpc.gov.ng/ndp-act-2023-gaid-2025-implementation-workshop/\nOfficial confirmation of the implementation framework and compliance-audit themes. Used for context, not statutory thresholds.",
      "baselineSha256": "ddefbf8b012cdbd1b7b93fdd39dd9fd21ebeb24d7c2a2bba29c2331c9f7eae9b"
    },
    {
      "id": "S07",
      "title": "NAFDAC: Micro, Small and Medium Enterprises",
      "url": "https://nafdac.gov.ng/our-services/msme/",
      "baselineNotes": "Official sector-discovery source. The page also contains historical tariff information; do not reuse those fees as current prices.",
      "category": "regulatory",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L568",
      "exactBaseline": "S07  NAFDAC: Micro, Small and Medium Enterprises\nhttps://nafdac.gov.ng/our-services/msme/\nOfficial sector-discovery source. The page also contains historical tariff information; do not reuse those fees as current prices.",
      "baselineSha256": "0bda496a58a4c6db74521357a30c99f93a773b5070a19525eef7a6ea34157be8"
    },
    {
      "id": "S08",
      "title": "Standards Organisation of Nigeria: MANCAP",
      "url": "https://son.gov.ng/mancapservice/",
      "baselineNotes": "Official overview of product conformity assessment. Product scope and exclusions need review before personalised applicability is published.",
      "category": "regulatory",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L571",
      "exactBaseline": "S08  Standards Organisation of Nigeria: MANCAP\nhttps://son.gov.ng/mancapservice/\nOfficial overview of product conformity assessment. Product scope and exclusions need review before personalised applicability is published.",
      "baselineSha256": "f654837595bc56475636a723c2869a8f1ed28bb665a28d51448aa2836f691957"
    },
    {
      "id": "S09",
      "title": "PenCom: contributory pension scheme FAQs",
      "url": "https://www.pencom.gov.ng/frequently-asked-questions-on-the-contributory-pension-scheme-2023-edition/",
      "baselineNotes": "Official FAQ index. Consult the current legislation and circulars before encoding employer thresholds or contribution rules.",
      "category": "regulatory",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L574",
      "exactBaseline": "S09  PenCom: contributory pension scheme FAQs\nhttps://www.pencom.gov.ng/frequently-asked-questions-on-the-contributory-pension-scheme-2023-edition/\nOfficial FAQ index. Consult the current legislation and circulars before encoding employer thresholds or contribution rules.",
      "baselineSha256": "9c56d84c350d995e2751688f7d6e7e2be53627d55e66ad78902f49b80b298efe"
    },
    {
      "id": "S10",
      "title": "Replit: publishing and hosting geography",
      "url": "https://docs.replit.com/learn/projects-and-artifacts/replit-deployments",
      "baselineNotes": "Supports the deployment boundary and hosting-geography assessment. Reconfirm geography for every contracted service at procurement.",
      "category": "platform",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L580",
      "exactBaseline": "S10  Replit: publishing and hosting geography\nhttps://docs.replit.com/learn/projects-and-artifacts/replit-deployments\nSupports the deployment boundary and hosting-geography assessment. Reconfirm geography for every contracted service at procurement.",
      "baselineSha256": "ab4d336fc0df56e63bea697d95a49f68a026c31abf0e550c4e2a94421a34f3fb"
    },
    {
      "id": "S11",
      "title": "Replit: deployment types",
      "url": "https://docs.replit.com/features/publishing/deployment-types",
      "baselineNotes": "Supports use of Autoscale for web requests and a Reserved VM for durable background processing.",
      "category": "platform",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L583",
      "exactBaseline": "S11  Replit: deployment types\nhttps://docs.replit.com/features/publishing/deployment-types\nSupports use of Autoscale for web requests and a Reserved VM for durable background processing.",
      "baselineSha256": "fe92935c44ff09a3b067faf0b562cc8f42e3eed0044afa9abede851e59636215"
    },
    {
      "id": "S12",
      "title": "Replit: development and production databases",
      "url": "https://docs.replit.com/features/data-and-storage/development-and-production",
      "baselineNotes": "Supports environment separation and the need to validate migration behaviour, grants and unsupported database objects.",
      "category": "platform",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L586",
      "exactBaseline": "S12  Replit: development and production databases\nhttps://docs.replit.com/features/data-and-storage/development-and-production\nSupports environment separation and the need to validate migration behaviour, grants and unsupported database objects.",
      "baselineSha256": "5b227fa3f44293e9e9dcadace52a575cebe76fcc0c01121d3187f82e55ac0dfc"
    },
    {
      "id": "S13",
      "title": "Replit: App Storage",
      "url": "https://docs.replit.com/features/data-and-storage/object-storage",
      "baselineNotes": "Storage service reference. Private access, backup, deletion and worker access must be proven in the technical spike.",
      "category": "platform",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L589",
      "exactBaseline": "S13  Replit: App Storage\nhttps://docs.replit.com/features/data-and-storage/object-storage\nStorage service reference. Private access, backup, deletion and worker access must be proven in the technical spike.",
      "baselineSha256": "52754f357340114e485edbc973d5b4fa957cff5e3b8fdaf789cf0aa5425b16b1"
    },
    {
      "id": "S14",
      "title": "Next.js: self-hosting",
      "url": "https://nextjs.org/docs/app/guides/self-hosting",
      "baselineNotes": "Reference for the proposed server-rendered application. Pin a supported version and validate proxy, caching and multi-instance behaviour.",
      "category": "platform",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L592",
      "exactBaseline": "S14  Next.js: self-hosting\nhttps://nextjs.org/docs/app/guides/self-hosting\nReference for the proposed server-rendered application. Pin a supported version and validate proxy, caching and multi-instance behaviour.",
      "baselineSha256": "7595975f1355bdaa558783b06da74a0e625818f72eb2d111cead821bc394ae45"
    },
    {
      "id": "S15",
      "title": "Clerk: Next.js integration",
      "url": "https://clerk.com/docs/nextjs/getting-started/quickstart",
      "baselineNotes": "Reference for the proposed managed identity integration; tenant authorisation remains Valo’s responsibility.",
      "category": "platform",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L595",
      "exactBaseline": "S15  Clerk: Next.js integration\nhttps://clerk.com/docs/nextjs/getting-started/quickstart\nReference for the proposed managed identity integration; tenant authorisation remains Valo’s responsibility.",
      "baselineSha256": "96bafe42eaba22d236fdd74fb72c3ea0e4bc1fa49fce30d1af0e3ee8a44ab4fe"
    },
    {
      "id": "S16",
      "title": "Paystack: webhooks",
      "url": "https://paystack.com/docs/payments/webhooks/",
      "baselineNotes": "Primary integration reference for signature verification, delivery retries and webhook handling. Follow the signing scheme active on the merchant account.",
      "category": "platform",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L598",
      "exactBaseline": "S16  Paystack: webhooks\nhttps://paystack.com/docs/payments/webhooks/\nPrimary integration reference for signature verification, delivery retries and webhook handling. Follow the signing scheme active on the merchant account.",
      "baselineSha256": "7c7d97e68a73b95d997c58806a1f7222314d0e670960c86a909db0588526360b"
    },
    {
      "id": "S17",
      "title": "Paystack: verify payments",
      "url": "https://paystack.com/docs/payments/verify-payments/",
      "baselineNotes": "Primary reference for server-side status verification and duplicate-fulfilment prevention.",
      "category": "platform",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L601",
      "exactBaseline": "S17  Paystack: verify payments\nhttps://paystack.com/docs/payments/verify-payments/\nPrimary reference for server-side status verification and duplicate-fulfilment prevention.",
      "baselineSha256": "cac0c5df4da848df1daa9b92ad7ec3e167da34797ab6dab2dfc91470429c31ee"
    },
    {
      "id": "S18",
      "title": "OpenAI: API data controls",
      "url": "https://developers.openai.com/api/docs/guides/your-data",
      "baselineNotes": "Assess endpoint-specific retention, account eligibility and geography; do not assume zero retention or uniform treatment across endpoints.",
      "category": "quality",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L608",
      "exactBaseline": "S18  OpenAI: API data controls\nhttps://developers.openai.com/api/docs/guides/your-data\nAssess endpoint-specific retention, account eligibility and geography; do not assume zero retention or uniform treatment across endpoints.",
      "baselineSha256": "92e78b7b85c4d76b2acf0e1c1b8b034d1f56ba255ef2ffb10e7b4f57a30955f3"
    },
    {
      "id": "S19",
      "title": "OWASP: Application Security Verification Standard",
      "url": "https://asvs.owasp.org/",
      "baselineNotes": "Security verification baseline. Level 2 is a proposed Valo target, not a certification claim.",
      "category": "quality",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L611",
      "exactBaseline": "S19  OWASP: Application Security Verification Standard\nhttps://asvs.owasp.org/\nSecurity verification baseline. Level 2 is a proposed Valo target, not a certification claim.",
      "baselineSha256": "52981321be461a398ff6f0480e82dedc1d8fe2f252b66bd613866bd61dbb84a6"
    },
    {
      "id": "S20",
      "title": "W3C: Web Content Accessibility Guidelines 2.2",
      "url": "https://www.w3.org/TR/WCAG22/",
      "baselineNotes": "Accessibility reference. AA is the proposed release target; automated checks alone do not establish conformance.",
      "category": "quality",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L614",
      "exactBaseline": "S20  W3C: Web Content Accessibility Guidelines 2.2\nhttps://www.w3.org/TR/WCAG22/\nAccessibility reference. AA is the proposed release target; automated checks alone do not establish conformance.",
      "baselineSha256": "f8f324f01f9b2af797aa39527f6d53c9c69ea4b7dbbfd92e18908615a8055d2e"
    },
    {
      "id": "S21",
      "title": "pg-boss: maintained PostgreSQL job queue",
      "url": "https://github.com/timgit/pg-boss",
      "baselineNotes": "Candidate durable job queue. Database privileges, migrations and worker compatibility must pass the foundation spike.",
      "category": "quality",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L617",
      "exactBaseline": "S21  pg-boss: maintained PostgreSQL job queue\nhttps://github.com/timgit/pg-boss\nCandidate durable job queue. Database privileges, migrations and worker compatibility must pass the foundation spike.",
      "baselineSha256": "c42079c5de8ce2b761904b77de87a215cec4f51cb87b1c3db61360c164cb13d0"
    },
    {
      "id": "S22",
      "title": "docx: JavaScript document-generation library",
      "url": "https://docx.js.org/",
      "baselineNotes": "Candidate DOCX renderer. Compatibility and layout are acceptance-test obligations, not assumed guarantees.",
      "category": "quality",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L620",
      "exactBaseline": "S22  docx: JavaScript document-generation library\nhttps://docx.js.org/\nCandidate DOCX renderer. Compatibility and layout are acceptance-test obligations, not assumed guarantees.",
      "baselineSha256": "3a91e5badffbb481a84c86ad66667c36421bd805459cd67dd5821c4a11b37b10"
    },
    {
      "id": "S23",
      "title": "Playwright: Page API and PDF generation",
      "url": "https://playwright.dev/docs/api/class-page#page-pdf",
      "baselineNotes": "Reference for PDF export and browser-based testing. Browser binaries and resource limits need production-worker validation.",
      "category": "quality",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L623",
      "exactBaseline": "S23  Playwright: Page API and PDF generation\nhttps://playwright.dev/docs/api/class-page#page-pdf\nReference for PDF export and browser-based testing. Browser binaries and resource limits need production-worker validation.",
      "baselineSha256": "0cab80a65da5b2da0ae6c756c65e3284a478e230b1b4189e060e9268262beb92"
    },
    {
      "id": "S24",
      "title": "NIST Artificial Intelligence Risk Management Framework Generative AI Profile",
      "url": "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf",
      "baselineNotes": "Voluntary risk guidance on confabulation, information integrity, provenance and evaluation. Supports the AI risk controls; not Nigerian law or approval of automated legal publishing. Checked 13 November 2026.",
      "category": "quality",
      "sourceLocator": "docs/specification/VALO-TRD-001-v1.1.txt:L626",
      "exactBaseline": "S24  NIST Artificial Intelligence Risk Management Framework Generative AI Profile\nhttps://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf\nVoluntary risk guidance on confabulation, information integrity, provenance and evaluation. Supports the AI risk controls; not Nigerian law or approval of automated legal publishing. Checked 13 November 2026.",
      "baselineSha256": "fa534e4febf9fd09494f3ae7f657b10ee0b311247bb87840f08acc8a6c224d8b"
    }
  ],
  "retentionProposals": [
    {
      "id": "RET-P01",
      "dataClass": "Active profiles, drafts and revisions",
      "exactProposal": "Retain while the account is active and needed; provide owner deletion. Trash recovery: 30 days; then delete unless a justified hold applies.",
      "status": "proposal_requires_G0_approval",
      "statutoryPeriod": false,
      "approved": false,
      "enforced": false
    },
    {
      "id": "RET-P02",
      "dataClass": "Closed account personal content",
      "exactProposal": "Target deletion from active systems within 30 days of verified closure, subject to approved exceptions; disclose backup expiry and third-party limits.",
      "status": "proposal_requires_G0_approval",
      "statutoryPeriod": false,
      "approved": false,
      "enforced": false
    },
    {
      "id": "RET-P03",
      "dataClass": "Generated exports and temporary assets",
      "exactProposal": "Regenerable exports: 30-day expiry, configurable; render temporary files: delete after job completion or within 24 hours after failure.",
      "status": "proposal_requires_G0_approval",
      "statutoryPeriod": false,
      "approved": false,
      "enforced": false
    },
    {
      "id": "RET-P04",
      "dataClass": "Routine logs and AI payloads",
      "exactProposal": "Operational logs: 30 days; AI operational metadata: 90 days; raw prompt/output bodies excluded from routine logs. Provider retention reviewed separately.",
      "status": "proposal_requires_G0_approval",
      "statutoryPeriod": false,
      "approved": false,
      "enforced": false
    },
    {
      "id": "RET-P05",
      "dataClass": "Security and administration audit",
      "exactProposal": "Proposed 12 months with strict access; extend only for a documented incident or legal need.",
      "status": "proposal_requires_G0_approval",
      "statutoryPeriod": false,
      "approved": false,
      "enforced": false
    },
    {
      "id": "RET-P06",
      "dataClass": "Orders, tax and payment records",
      "exactProposal": "Provisional seven-year business-record schedule, subject to source-grounded assessment and owner policy approval. Minimise identifiers; do not retain unrelated drafts for a hold.",
      "status": "proposal_requires_G0_approval",
      "statutoryPeriod": false,
      "approved": false,
      "enforced": false
    },
    {
      "id": "RET-P07",
      "dataClass": "Backups",
      "exactProposal": "Proposed 35-day rolling recovery retention; deletion tombstones must be reapplied after restore so deleted accounts are not inadvertently reactivated.",
      "status": "proposal_requires_G0_approval",
      "statutoryPeriod": false,
      "approved": false,
      "enforced": false
    }
  ],
  "interpretation": "Dates, staffing, weeks and budgets are assumptions, not commitments. R1 precedes gated R2; R3 is excluded. Retrieval is not source/rights/AI approval. No retention duration is enacted by this intake.",
  "approvals": {
    "productLaunch": false,
    "livePayments": false,
    "liveCustomerData": false,
    "retentionSchedule": false
  }
} as const;

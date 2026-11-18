# Outside services, data and regions (OPS-006, PRV-002): draft for the privacy owner

**Status: draft, not approved.** This records what the code sends to each outside service and what
is known about where that service keeps it. No contract, data processing agreement, subprocessor
list, transfer assessment or region has been reviewed, confirmed or approved. Valo processes only
synthetic data, and it makes no claim that customer data stays in Nigeria or that any provider
retains nothing.

The requirements, verbatim:

- **OPS-006.** "Record actual hosting and processor regions before live data. Replit documentation
  describes US hosting by default and an enterprise EU request option; obtain the relevant transfer
  assessment and contracts." Accepted when there is "no claim that Nigerian customer data stays in
  Nigeria without proof."
- **PRV-002.** "Approve provider contracts, subprocessors, actual storage/processing regions and data
  settings before live data." Accepted with a "documented review covers Replit, identity, email,
  payments, AI and monitoring; no unverified 'zero retention' promise."

"Not verified" below means nobody has confirmed it against the provider's contract or account
settings. The specification's notes on sources S10 (Replit hosting geography) and S18 (OpenAI data
controls) say the same: reconfirm geography at procurement, and do not assume zero retention.

## Services

| Service | Kind | What the code sends it | Region | Retention | Contract |
| --- | --- | --- | --- | --- | --- |
| Replit | Hosting, PostgreSQL, App Storage, secrets | Everything the app stores: workspaces, profiles, drafts and revisions, exports, tasks, orders, audit and support records. Private files go to App Storage, which the code reaches through `storage.googleapis.com` (Google Cloud Storage). | Not verified. The specification notes Replit documents US hosting by default and an EU option on enterprise request (S10). | Not verified. Replit's recovery documentation is retained in `docs/valo/evidence/platform/`; Valo's own backup retention is a separate proposal awaiting approval. | Not reviewed |
| Clerk | Identity | Sign-in and sign-up through Clerk's own pages and scripts; the API reads the user id, session and verified email. Browsers also load Clerk's images (`img.clerk.com`) and Cloudflare's sign-up challenge (`challenges.cloudflare.com`), which the content security policy allows. | Not verified | Not verified | Not reviewed |
| Resend, through Replit Connectors | Email | Development test mail only: reminder text to the one configured test recipient, who must be the user's verified address. Real customer email is not sent. | Not verified | Not verified | Not reviewed |
| Paystack | Payments (test mode only) | At checkout: the order reference, amount in kobo, currency (NGN), the buyer's email, the return URL and the order and workspace ids. Refund and dispute requests by reference. Dispute evidence uploads go to a Paystack-issued upload address on `s3.eu-west-1.amazonaws.com` (AWS, Ireland), the only upload host the code allows. Live keys are refused. | Not verified, apart from the upload host the code allows | Not verified | Not reviewed |
| OpenAI, through Replit AI Integrations | AI | When enabled: customer drafting requests carry the customer's own draft answers; editorial runs carry retained official source text and candidate content. Both run only inside an owner-approved finite allocation, and none is approved. Requests may set the provider's `store` field. | Not verified | Not verified. No zero-retention claim: S18 says retention differs by endpoint and account and must be assessed, which has not been done. | Not reviewed |
| Healthchecks.io | Monitoring | When configured, heartbeat pings to `hc-ping.com` saying only whether the worker and operations checks are healthy: no customer data, counts, errors or request bodies. Not provisioned. | Not verified | Not verified | Not reviewed |
| GitHub | Source code and CI | The public repository and CI runs on synthetic data. No customer data. | Not applicable | Not applicable | Public repository by owner decision of 16 November |

The web app's fonts are served by the app itself, so no visitor request goes to a font provider.

## Before any live data

1. Obtain each provider's contract or data processing terms, subprocessor list and the regions of
   the resources actually provisioned, and record them here with their dates.
2. Assess transfers out of Nigeria for each provider against the applicable Nigerian data protection
   requirements; this repository does not make that assessment.
3. For the AI provider, record the endpoint-specific retention and the account's data settings, and
   state no retention period that has not been confirmed.
4. The privacy owner approves this document, or names what blocks approval.

A test (`scripts/src/valo/r1-boundaries.test.ts`) fails if the web app claims customer data stays in
Nigeria, or that a provider keeps no data, unless the sentence disclaims it, and if this document
stops covering hosting, identity, email, payments, AI and monitoring.

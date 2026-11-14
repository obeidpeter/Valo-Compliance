# Purchase history, bounded payment mechanics and content-read correction

This is partial development implementation, not acceptance of PAY, R1, R2 or launch.
The aggregate execution evidence is
[`evidence/commerce-development-checkpoint.json`](evidence/commerce-development-checkpoint.json).
The complete original requirements and content candidates are preserved.

## Working implementation

- Verified workspace customers have a durable purchases screen: server-priced
  order snapshots, accepted licence version/text, payment state, safe status
  refresh, receipt download after verified success, and refund request history.
  Empty/loading/error states remain useful. No prices or commercial approvals
  were seeded; no currently eligible product is offered for sale.
- Order creation accepts a price ID, accepted licence version and idempotency
  key, not browser amounts/currency/discounts. A held/withdrawn product cannot
  become an order. Baseline free templates cannot silently become paid products.
- Paystack adapter initialization and server verification use the fixed official
  host, timeouts, test-key guards and an unchanged order reference. Actual
  merchant calls have **not** run. Missing configuration produces an explicit
  error without claiming payment.
- Settlement locks the order, checks test domain/reference/amount/currency and
  order/workspace metadata, then atomically records the order, entitlement,
  receipt outbox and audit event. Browser callback parameters cannot grant access.
  A reversed transaction cannot be reactivated by a replay.
- Raw-body webhook authentication implements explicitly configured timestamped
  signing-secret mode (300-second bound and rotation) or legacy mode. It never
  silently downgrades. Authenticated minimal event facts are saved before ACK.
  Card/customer payloads are not retained. A durable worker processes events and
  daily reconciliation records; missing configuration consumes no attempts.
- Refund requests remain **requested**, not authorised/refunded. They do not
  delete drafts or retract local files. PSP refund submission/confirmation and
  the approved eligibility/authorisation lifecycle remain unfinished.
- Finance staff screens now show minimal order/refund/reconciliation records
  behind existing role/MFA checks, without document bodies. Workspace data
  export includes the new tenant-owned commercial records.
- Publication discovery/downloads now recheck the actual original authoring
  route, including scoped ChatGPT permission, instead of always requiring the
  unrelated Replit-authoring record. Actual private evidence reads verified the
  latest candidate's permission; that candidate **remains held**. This is not
  a successful publication or withdrawal drill.
- Mobile sign-in/sign-up no longer inherit the provider card's desktop minimum
  width. Forms and account-access help stay reachable without hiding overflow.

## Executed checks

| Check | Actual outcome |
|---|---|
| API/domain regression | 71 passed, zero failed, one opt-in skip |
| PostgreSQL regression, explicitly enabled | 49 passed, zero skipped |
| Controlled commerce database proof | 14 runner tests / 13 leaf cases passed |
| Isolated real HTTP webhook controls | 5 runner tests / 4 leaf cases passed |
| Managed identity/browser | 3 groups passed, cleanup errors zero |
| Purchase UI widths | 360, 390, 768, 1280 pixels; persisted unpaid controlled order, reload, licence, visible keyboard focus and real prerequisite errors |
| Public sign-in/sign-up | 320, 360, 390, 768, 1280 pixels; fields/help within viewport |
| Empty local PostgreSQL migration installation | Registered SQL applied; four commercial tenant foreign keys and publisher-denial invariants passed; zero seeded prices/orders; local cluster removed |
| Foundation | 166 passed; synthetic engine fixtures are not Nigerian rule acceptance |
| Code generation, workspace types, Next.js build | Passed |

The database settlement responses and HTTP signing secret were explicitly
controlled test inputs, **not Paystack execution or delivery**. The browser
used real managed test identity, application APIs and PostgreSQL; its unpaid
order was a labelled fixture, not a released product or purchase.

The initial fixture test failed against append-only publication controls.
That failure is retained, not bypassed. Tests now reuse a real held candidate.
Two abandoned owned synthetic workspaces were removed; the failed immutable
synthetic policy record remains retained and is not an authorised policy.
Browser harness focus/selector/request-contract failures were retained under
generated development evidence and corrected; mandatory assertions were not
removed. The JSON mutation contract now matches the existing CSRF boundary.

## Exact dependent setup and remaining gates

Both `PAYSTACK_SECRET_KEY` and `PAYSTACK_WEBHOOK_SECRET` were confirmed absent
through secret-existence checks. For a future authorised sandbox run, configure
the test merchant securely, choose its actual `PAYSTACK_WEBHOOK_MODE`
(`timestamped` or `legacy`), configure signing material for that mode, and enable
`VALO_SANDBOX_CHECKOUT_ENABLED=true` in development. The application refuses live
keys, deployment execution and unconfigured modes. No secret value belongs in
chat, documentation, client bundles or Git.

Before any sales, actual commercial prices, tax treatment, licence and refunds
still need the specified owner decisions. No such decision was fabricated.
Verified email-provider configuration/delivery remains absent; receipt outbox
records honestly say `awaiting_email_configuration`.

The editorial cap remains six review reservations per UTC database day; six
were used when checked. No new model call ran in this batch and no cap was
raised. Revised candidate v6 needs its own real independent checks. Permission
alone does not clear review, rights, publication or commercial gates.

Published templates/guidance/guides/packs and released rules remain zero. The
formal source-backed 80-rule, supplied 60-customer-AI and 60-editorial acceptance
work remains incomplete. Real Paystack purchase/refund/reconciliation,
production worker/storage compatibility, isolated disaster recovery/RPO/RTO,
independent security/privacy review, legacy-Zod remediation, manual accessibility
and real-user beta remain open. Clean local migration installation is **not**
backup restoration or production recovery proof. R2 remains locked by R1 gates;
R3 remains excluded. Live payments and public launch remain disabled.

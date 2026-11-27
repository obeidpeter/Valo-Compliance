# Paystack dispute contract implementation — controlled development

The official API reference and workflow guide were freshly retrieved:
- https://paystack.com/docs/api/dispute/
- https://paystack.com/docs/payments/manage-disputes/

The adapter uses GET canonical dispute, GET upload URL, separate object PUT,
POST structured evidence and PUT resolution. Merchant resolutions are
`merchant-accepted` and `declined`, never a made-up bank-win state. Amounts
are integer subunits; declines require an acknowledged provider filename and
declining fraud claims requires structured evidence. Accepting a fraud claim does not require fabricated evidence or delivery details. Unsupported/terminal current states
hold a new mutation. Evidence receipts must identify the selected dispute.

Object PUT is restricted to the official documented destination, expires no
later than 30 minutes, forbids redirects and never carries merchant
Authorization. A successful empty HTTP body is accepted by status. Only bounded
server-generated receipt PDFs are supported, not arbitrary attachments.

No financial mutation is automatically retried. The adapter alone is not the
durable staff workflow; the subsequent implementation must persist/authorize
intent before dispatch, derive source records server-side and reconcile
unknown results. Neither API success nor archived/declined establishes a final
bank outcome. Terminal observations alone no longer newly suspend access;
previously suspended access is not automatically restored.

Executed: 12 controlled transport checks, 17 existing development refund
regression checks and workspace typecheck passed. No real merchant call ran.
Configured signing mode was not changed. Current real test-dispute availability
is **unverified**, not declared unsupported. R1/R2 remain unaccepted.

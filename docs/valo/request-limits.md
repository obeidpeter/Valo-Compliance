# Request limits

How many requests the API accepts from one caller, and how an operator changes those limits. It covers
SEC-005, "Abuse and quotas": "Start with configurable ceilings: anonymous reads 60/min/IP, authenticated
reads 120/min/user, AI 5/min, checkout and export creation 10/min/user plus account limits. Accept:
legitimate errors explain recovery; distributed abuse and financial-cost spikes trigger alerts." It is
part 2 of [small hardening](../architecture/small-hardening.md) (slice 5). The values below are
today's ceilings. They are development defaults, and the owner sets the production values.

## The limits

Each limit is counted in the database, by the database's clock, across every API process. Each has a
setting of its own; unset or empty, it is the default.

| Setting | Counts | Default |
| --- | --- | --- |
| `VALO_LIMIT_ANONYMOUS_READ` | Reads by one visitor or address not signed in, a minute | 60 |
| `VALO_LIMIT_AUTHENTICATED_READ` | Reads by one signed-in account, a minute | 120 |
| `VALO_LIMIT_PAGE_RENDER_READ` | Reads by every page the web server renders, for all visitors together, a minute | 600 |
| `VALO_LIMIT_CUSTOMER_AI` | Drafting assistant requests by one account, a minute | 5 |
| `VALO_LIMIT_CHECKOUT_CREATE`, `_DAY` | Checkouts begun by one account, a minute and a day | 10 and 100 |
| `VALO_LIMIT_EXPORT_CREATE` | Document exports asked for by one account, a minute | 10 |
| `VALO_LIMIT_PROFILE_WRITE`, `_DAY` | Business profile changes by one account | 20 and 200 |
| `VALO_LIMIT_DOCUMENT_WRITE`, `_DAY` | Document changes by one account | 30 and 600 |
| `VALO_LIMIT_SUPPORT_WRITE`, `_DAY` | Support messages by one signed-in customer | 3 and 20 |
| `VALO_LIMIT_STAFF_SUPPORT_WRITE`, `_DAY` | Support actions by one member of staff | 20 and 200 |
| `VALO_LIMIT_REFUND_CREATE`, `_DAY` | Refund requests by one account | 10 and 50 |
| `VALO_LIMIT_PUBLIC_SUPPORT`, `_DAY` | Support requests from people not signed in, from one contact address | 3 and 20 |
| `VALO_LIMIT_PUBLIC_SUPPORT_SOCKET`, `_DAY` | The same, from one network address | 20 and 100 |
| `VALO_LIMIT_PUBLIC_SUPPORT_ALL`, `_DAY` | The same, from everyone together | 100 and 1000 |

A setting ending `_DAY` counts by the day, and the others by the minute. The table in code is
`quotaPolicy` (`artifacts/api-server/src/lib/valo-quota-policy.ts`), and `.env.example` lists every
setting. The drafting assistant's two daily allowances are not here: they are the owner's versioned
commercial settings.

## Changing a limit

- **The value:** a whole number from 1 to 10,000, written plainly (`25`, never `25.0`, `025` or `1e2`).
- **Where to set it:** in the environment of the API and the worker, then restart both.
- **A value it cannot read:** the API and the worker refuse to start. Each stops at once, naming the
  setting (`RequestLimitSettingInvalid: VALO_LIMIT_…`), before it serves a request or takes a job.
- **What the alerts read:** the worker's alerts on callers at a limit count each one at the limit the
  settings give.

## What a caller meets at a limit

- The answer is 429, with `Retry-After`, and a sentence that says how to carry on, such as when to try
  again or that what was saved is unchanged.
- A read also carries `X-RateLimit-Limit`, the limit it met, and `X-RateLimit-Remaining`.
- Each refusal is counted by keyed address, never the address itself, for the alerts on limited
  callers ([alerts](../architecture/alerts.md)).

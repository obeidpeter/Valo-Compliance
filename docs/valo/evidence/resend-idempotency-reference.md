# Resend idempotency reference

Official source: https://resend.com/docs/dashboard/emails/idempotency-keys

Retrieved: 2026-11-14T11:09:22.439Z

Retrieved-text SHA-256: 1cf1a652519a4d5758169ea78725c070483d4aea38a3fa64008b5f3e16d2ac32

Selected actual passages (not proof of Valo delivery):

> When you send an email with an idempotency key, Resend checks whether an email with the same idempotency key has already been sent in the last 24 hours. This is an optional feature that simplifies managing retries on your side.This makes it safe to retry requests that send an email. You don’t have to worry about checking if the original request was sent. Instead, you can make the same request and our API will give the same response, without actually sending the email again.

> Idempotency keys can be up to 256 characters and must be unique per API request.We recommend that you use a UUID or other string that uniquely identifies that specific email.

> Send the key in the `Idempotency-Key` HTTP header in your API requests. Our SDKs also provide a convenient way to set this header. If you’re using SMTP, you can set the `Resend-Idempotency-Key` email header instead.Idempotency keys are kept in the system for **24 hours**. This gives you an ample window to retry any failed processes on your end without having to keep track of the sent status.

>   - `400`: `invalid_idempotency_key` \- the idempotency key has to be between 1–256 characters. You can retry with a valid key or without supplying an idempotency key.

The raw fetched page is retained in the ignored development evidence directory. Valo conservatively stops replay after 23 hours from a durable first attempt; it does not claim that keys deduplicate forever.

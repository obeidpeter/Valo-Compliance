# Complete scoped workspace downloads

The customer JSON download now uses ordered 500-row pages in one repeatable-read
snapshot, rather than refusing any section over 5,000 rows or the combined file
over 8 MB. All rows in the named sections are included. The schema and exclusions
remain unchanged: this is scoped application access, not complete privacy
fulfilment or an archive of private Word/PDF bytes or external-provider records.

The server builds the complete snapshot in a private temporary directory with a
0600 file before releasing download headers. It checks workspace access before
the snapshot and again before delivery. The download uses streaming transport,
and scratch is removed after success, reader failure or disconnect. A build
failure does not return a successful truncated JSON file. The existing bounded
in-memory helper used for prepared staff results still fails explicitly at its
limit; it is not silently substituted for the full customer download.

Executed: workspace typecheck passed; 15/15 actual development PostgreSQL
customer-access tests passed, including a >5,000-row download, tenant and actor
scope, excluded private storage/queue fields, 0600 scratch permissions, cleanup
and consumer failure. The first implementation exposed a missing `id` on the
one-row reminder-preferences table; the final implementation orders that section
by its workspace primary key. The failed attempt was not a passing test.

Limits: process-kill scratch cleanup and a full large-account browser memory
benchmark are not proved by these tests. The browser currently parses the JSON
before offering its download. Physical erasure and external-system fulfilment
remain separate unfinished work. No provider call, charge, email, publication,
R1/R2 acceptance or production-recovery claim is made.

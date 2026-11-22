# 0018 — Manual library publishing

The product owner approved a publishing workflow with a $0 review budget on 22 November 2026. A content editor can publish practical guides, industry introductions and business templates after previewing them. Regulatory articles stay private pending the owner's source check.

## Staff workflow

Open **Staff → Content → Publish guides and templates**. Choose **New item**, enter the title, and choose a content type and industry. General business is available for guides and templates. Each industry can have one live introduction.

Paste text or upload a Word (.docx) or PDF file up to 2 MB. Valo reads the text locally. For a scanned PDF, enter the text readers should see. Choose **Save draft and preview**. A template preview includes a download of the exact file. Pasting a template creates a Word file. Choose **Publish this version** to release the preview.

Open a saved entry to make a correction. Readers see the current release until an editor publishes the correction. **Withdraw live version** takes it out of the library and disables fresh downloads of that version. Copies readers already downloaded stay with them.

## Editorial authority

The application requires an active Content role and recent MFA. It records the editor and date for each saved, published and withdrawn version. It uses the existing database, a separate item identity, and a fingerprint of the previewed text and attachment. Every revision keeps its original content type. A new public version requires an explicit staff action. The editing routes make no AI calls and create no review allocations or worker jobs.

Readers can filter Guides by industry. An industry introduction also appears on its category page. Templates appear in Documents, and signed-in readers can download their published file. The publication date is identified as editorial publication. Industry introductions contribute no source-check dates or regulatory evidence. Previously reviewed releases continue to use their recorded evidence and existing file access rules.

Existing project drafts can be pasted or uploaded individually. The editor saves regulatory drafts privately. Both the API and PostgreSQL enforce the regulatory hold, including new releases through the earlier sourced-guidance publisher. Enabling regulatory publication after the owner's source check requires a separate change.

## Development rollout and rollback

1. Verify a restorable backup of the development database and confirm the journal ends at the publisher-login migration. Keep the development worker stopped.
2. Apply the journalled migration `20261122124112_manual_library` in its transaction using the existing development migration procedure. It creates an empty editorial table, indexes, and two transition guards. Existing content and permissions are preserved.
3. Serve the updated web and API code. PDF extraction needs Poppler, included in the checked-in runtime configuration. Sign in to Staff → Content and save a private test draft. Verify its absence from Guides before publishing.
4. If application rollout fails, revert the application to the preceding build and retain the additive migration, its source hold and editorial history. A failed migration transaction can be retried after checking the journal. For database recovery use the verified backup and preserve any intervening editorial work before restoring.

The synthetic integration tests exercise the browser, API and PostgreSQL together. The migration rehearsal covers tracked and unjournalled upgrades and a transaction interrupted before commit.

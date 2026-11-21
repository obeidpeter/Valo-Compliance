# R2 team access: membership design

Status: proposed. Nothing here is implemented. The decisions at the end belong to
the owner.

## What the specification asks for

- **Roles** (TRD section 03): a team editor or viewer may "edit or view
  specifically authorised business content", with "no billing, ownership transfer
  or invitations unless separately granted".
- **Data model** (TRD, User → Membership → Workspace): identity-provider ID
  unique; one membership per user and workspace; role and status; at least one
  owner; workspace deletion state.
- **R2 roadmap** (weeks 21–24): role-based team invitations.
- **SEC-001**: check tenant membership and the specific resource permission in
  every API, background job, search query and download. Acceptance: automated
  negative tests try cross-tenant ID substitutions for every private entity type.

## What R1 assumes today

- `valo_membership_identity_unique` allows one membership per identity, and
  `valo_workspace_owner_unique` allows one owned workspace per identity.
- `resolveWorkspace(identityId)` finds that single membership, or creates a
  workspace on first sign-in. It returns `{ workspaceId, identityId }` with no
  role. Every private route assumes the caller owns the workspace.
- `valo_memberships.role` already allows `owner` and `member`, but nothing reads it.

## Proposed model

**Roles.** `owner`, `editor` and `viewer` on the membership. Owners see and
change everything in their workspace. Editors and viewers reach only the content
they are granted.

**Grants.** A new `valo_membership_grants` table (membership, resource type,
resource ID, `view` or `edit`) records "specifically authorised business
content". The first resource types are documents, assessments and task lists.

**Capabilities.** `billing` and `invite` can be granted separately to a
non-owner, as the specification allows. Ownership transfer is not offered unless
the owner decides otherwise (decision 4).

**Invitations.** A new `valo_workspace_invitations` table stores the workspace,
role, the inviter, a hash of a single-use token, an expiry and a status. The
invitee's email address is personal data and is kept only until the invitation
is accepted or expires. Accepting requires a signed-in identity with a verified
email that matches the invitation.

**Integrity in the database.**
- A unique index on (workspace, identity) replaces the identity-only index.
- A trigger keeps at least one active owner per workspace, like the existing
  last-administrator guard for staff roles.
- Membership, grant and invitation changes are append-only audit rows, protected
  by the same triggers as other audit history.

## Request handling

- **Workspace selection.** A request may name a workspace (for example
  `/api/v1/workspaces/:id/...`, as the TRD's API table shows). That ID only
  selects; access comes from the server-side membership lookup. A workspace the
  caller is not a member of returns 404, so IDs cannot be probed. Without a
  selection, the caller's owned workspace is used, so R1 routes keep working.
  `AGENTS.md` currently says never to accept a workspace from the browser; when
  this lands, that rule changes to "a browser-supplied workspace ID is only a
  selector".
- **Workspace context.** `resolveWorkspace` returns a context with the role,
  capabilities and a `can(action, resource)` check. Module services receive the
  context, and every query is scoped by it (the Phase 3 workspace context).
  Routes never decide permissions.
- **Freshness.** Membership, role and grants are read from the database on every
  request, so removing a member applies at once. The one-minute Clerk cache
  (decision 0003) covers only the identity provider's session state.
- **Jobs and downloads.** Export jobs and downloads re-check the requesting
  membership and grant when they run and when bytes are released, not only when
  queued.

## Permission matrix (proposed defaults)

| Action | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| View granted documents, assessments, tasks | yes | yes | yes |
| Edit granted content | yes | yes | no |
| Export or download granted documents | yes | decision 2 | decision 2 |
| Business profile | edit | view | view |
| Orders, purchases, refunds, receipts | yes | with `billing` | with `billing` |
| Invite or remove members, change grants | yes | with `invite` | with `invite` |
| Delete the workspace | yes | no | no |
| Own privacy requests (access, erasure) | yes | yes | yes |

Purchases belong to the workspace, matching the proposed licence ("one
business's internal use"). Members use purchased templates only within their
grants.

## Migration path (expand, then contract)

1. **Expand:** add the grants and invitations tables, the (workspace, identity)
   unique index, the owner-minimum trigger and the audit triggers. Existing
   memberships become `owner`. The R1 code keeps working unchanged.
2. **Code:** introduce the workspace context and the permission checks; add
   role and grant tests and SEC-001 substitution tests for every private entity
   type; then enable invitations.
3. **Contract:** drop `valo_membership_identity_unique` once no code assumes a
   single membership.

## Privacy

- Erasing a member removes their memberships, grants and pending invitations,
  and leaves the workspace and its content with the owner.
- Erasing the last owner needs a defined outcome: workspace deletion, or
  transfer if the owner allows it (decision 4).
- The privacy notice must cover team members, invitation emails and their
  retention.

## Decisions for the owner

1. Workspace-wide roles only, or per-item grants as proposed? The specification's
   "specifically authorised" suggests grants.
2. May editors and viewers export or download the documents they can see?
3. How are invitations delivered? Sending email is an external message that
   needs approval and a configured provider; a copyable single-use link needs
   neither.
4. Is ownership transfer offered, and what happens when the last owner leaves or
   is erased?
5. Are team seats free or a paid feature? R2 also introduces optional subscriptions.

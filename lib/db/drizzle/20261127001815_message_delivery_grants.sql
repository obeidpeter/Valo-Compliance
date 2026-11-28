-- The worker's messages job records what the email provider reported about a workspace's message or
-- reminder in that workspace's scope, and customer requests read their own workspace's reports
-- (docs/architecture/messages.md, part 3). The reports as they arrive, in valo_email_events, name no
-- workspace: the scoped role has no access to them. An erasure removes a workspace's reports on the
-- application's own connection.
GRANT SELECT, INSERT, UPDATE ON public.valo_message_deliveries TO valo_workspace_scope;

-- Customer requests add a change to their own workspace's optional choices and read their own; nothing
-- changes or removes one (docs/architecture/processing-inventory.md, slice 4). An erasure removes a
-- workspace's changes on the application's own connection.
GRANT SELECT, INSERT ON public.valo_consent_changes TO valo_workspace_scope;

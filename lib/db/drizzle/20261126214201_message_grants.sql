-- Customer requests add a message their own action owes, such as a receipt when they confirm a payment,
-- and read their own workspace's messages. The dispatcher, in the message's workspace scope, changes only
-- a message's state: never its workspace, kind, class, recipient or the record it is about
-- (docs/architecture/messages.md, part 1). An erasure removes a workspace's messages on the application's
-- own connection.
GRANT SELECT, INSERT ON public.valo_messages TO valo_workspace_scope;--> statement-breakpoint
GRANT UPDATE (status, reason, attempts, sender, provider_message_id, lease_token, lease_until,
  next_attempt_at, first_attempt_at, last_attempt_at, accepted_at, updated_at)
  ON public.valo_messages TO valo_workspace_scope;

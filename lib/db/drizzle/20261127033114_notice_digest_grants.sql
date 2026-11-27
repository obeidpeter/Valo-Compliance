-- The worker records that a day's notices owe a workspace a message, and queues it, on the application's
-- own connection (docs/architecture/messages.md, part 7). In the message's workspace scope the dispatcher
-- reads the day the message is about, and a customer's request reads it to list the message. Neither
-- writes a row. An erasure removes a workspace's rows on the application's own connection.
GRANT SELECT ON public.valo_notice_digests TO valo_workspace_scope;

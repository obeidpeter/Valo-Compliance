CREATE TABLE valo_privacy_messages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  reply_to_version integer NOT NULL CHECK(reply_to_version > 0),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valo_privacy_message_case FOREIGN KEY(case_id,workspace_id) REFERENCES valo_privacy_cases(id,workspace_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX valo_privacy_message_reply ON valo_privacy_messages(case_id,reply_to_version);

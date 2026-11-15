-- Retain authenticated minimal audit evidence without retaining the removed text.
-- No existing customer row is changed by this migration.
CREATE TABLE valo_privacy_redactions (
  table_name text NOT NULL CHECK (table_name IN ('valo_privacy_events','valo_refund_transitions')),
  row_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  projection jsonb NOT NULL,
  proof jsonb NOT NULL,
  key_version text NOT NULL,
  mac text NOT NULL,
  PRIMARY KEY(table_name,row_id)
);
CREATE INDEX valo_privacy_redaction_workspace ON valo_privacy_redactions(workspace_id);
--> statement-breakpoint
CREATE TRIGGER valo_privacy_redaction_immutable BEFORE UPDATE OR DELETE ON valo_privacy_redactions
  FOR EACH ROW EXECUTE FUNCTION valo_financial_history_immutable();
REVOKE ALL ON valo_privacy_redactions FROM PUBLIC;
--> statement-breakpoint
-- A refund transition still cannot be deleted or generally rewritten. The only
-- exception is an exact reason-only projection already recorded by erasure.
CREATE OR REPLACE FUNCTION valo_financial_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='valo_refund_transitions' AND TG_OP='UPDATE' THEN
   IF NEW.reason='[Private content removed by verified workspace erasure]'
     AND (to_jsonb(NEW)-'reason')=(to_jsonb(OLD)-'reason')
     AND EXISTS(SELECT 1 FROM valo_privacy_redactions r
       WHERE r.table_name=TG_TABLE_NAME AND r.row_id=OLD.id
       AND r.workspace_id=OLD.workspace_id AND r.projection=to_jsonb(NEW)) THEN
     RETURN NEW;
   END IF;
 END IF;
 RAISE EXCEPTION 'Financial audit history is append-only';
END $$;

-- Append-only financial transition history. No customer data is rewritten.
CREATE FUNCTION valo_financial_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Financial audit history is append-only';
END $$;
CREATE TRIGGER valo_refund_transition_immutable
 BEFORE UPDATE OR DELETE ON valo_refund_transitions
 FOR EACH ROW EXECUTE FUNCTION valo_financial_history_immutable();
REVOKE UPDATE,DELETE,TRUNCATE ON valo_refund_transitions FROM PUBLIC;

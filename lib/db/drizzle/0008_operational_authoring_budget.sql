-- DEVELOPMENT ONLY, additive budget/receipt support. No plan or monetary budget change.
-- Six review attempts/day remain unchanged; one separately metered authoring attempt/day.
BEGIN;
ALTER TABLE valo_publication_ai_attempts DROP CONSTRAINT valo_publication_ai_attempts_role_check;
ALTER TABLE valo_publication_ai_attempts ADD CONSTRAINT valo_publication_ai_attempts_role_check
 CHECK(role IN('draft','factual','challenge'));
COMMIT;

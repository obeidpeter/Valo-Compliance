-- Whether Valo has stopped sending optional messages to an address (docs/architecture/messages.md,
-- part 3). A reminder is delivered inside its workspace's scope, where the suppressions cannot be read:
-- they name no workspace, and a customer request must not list them. So the one question a sender needs
-- answered is asked through this function, which runs as its owner and returns only yes or no, for a
-- keyed checksum the caller must already hold. The checksums are given under each key version the caller
-- knows, one beside the other.
CREATE FUNCTION public.valo_email_address_suppressed(p_key_versions text[], p_address_hashes text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.valo_email_suppressions s
    JOIN unnest(p_key_versions, p_address_hashes) AS given(key_version, address_hash)
      ON s.key_version = given.key_version AND s.address_hash = given.address_hash
    WHERE s.expires_at > now()
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_email_address_suppressed(text[], text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.valo_email_address_suppressed(text[], text[]) TO valo_workspace_scope;

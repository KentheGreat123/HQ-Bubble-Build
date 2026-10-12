-- PROPOSAL ONLY. Not an HQ migration. Not executed.
-- Requires separate approval and a wrapper proving 127.0.0.1:55452 and the
-- existing imported restore target. Never execute on hosted Supabase or 54322.
-- Source definitions: verified 20261012T022301087Z backup; existing table owner
-- remains supabase_auth_admin. No grants, table recreation, role or data changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog;
DO $$
BEGIN
  IF current_user <> 'supabase_admin' OR current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Unexpected restore identity';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM vault.secrets) THEN
    RAISE EXCEPTION 'Empty baseline changed; stop for review';
  END IF;
END;
$$;
CREATE INDEX idx_users_created_at_desc ON auth.users USING btree (created_at DESC);
CREATE INDEX idx_users_email ON auth.users USING btree (email);
CREATE INDEX idx_users_last_sign_in_at_desc ON auth.users USING btree (last_sign_in_at DESC);
CREATE INDEX idx_users_name ON auth.users USING btree (((raw_user_meta_data ->> 'name'::text))) WHERE ((raw_user_meta_data ->> 'name'::text) IS NOT NULL);
COMMIT;

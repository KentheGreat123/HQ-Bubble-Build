-- Atomic publication: no client can observe partially hardened objects.
do $hq_migration$
declare vault_function record;
begin
-- No accounts, credentials or production data are seeded by migrations.
create schema if not exists hq_private;
revoke all on schema hq_private from public, anon, authenticated;
create extension if not exists supabase_vault with schema vault;

create table public.hq_accounts (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 200),
 active_connection_id uuid, materials_enabled boolean not null default false,
 created_at timestamptz not null default now(), check(not materials_enabled or active_connection_id is not null)
);
alter table public.hq_accounts enable row level security;
alter table public.hq_accounts force row level security;
revoke all on public.hq_accounts from public, anon, authenticated;
create table public.hq_users (
 id uuid primary key references auth.users(id) on delete restrict,
 display_name text not null check(length(display_name) between 1 and 200), disabled boolean not null default false
);
alter table public.hq_users enable row level security;
alter table public.hq_users force row level security;
revoke all on public.hq_users from public, anon, authenticated;
create table public.hq_memberships (
 account_id uuid not null references public.hq_accounts(id), user_id uuid not null references public.hq_users(id),
 role text not null check(role in ('owner','admin','technician','viewer')), active boolean not null default true,
 primary key(account_id,user_id)
);
alter table public.hq_memberships enable row level security;
alter table public.hq_memberships force row level security;
revoke all on public.hq_memberships from public, anon, authenticated;
create table public.hq_platform_connections (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.hq_accounts(id),
 platform text not null check(platform in ('housecallpro','servicetitan')),
 external_account_id text not null check(length(external_account_id) between 1 and 256),
 version integer not null default 1 check(version>0), status text not null default 'inactive' check(status in ('inactive','active')),
 created_at timestamptz not null default now(), unique(account_id,id)
);
alter table public.hq_platform_connections enable row level security;
alter table public.hq_platform_connections force row level security;
revoke all on public.hq_platform_connections from public, anon, authenticated;
create unique index hq_one_active_platform on public.hq_platform_connections(account_id) where status='active';
create unique index hq_one_external_company on public.hq_platform_connections(platform,external_account_id) where status='active';
alter table public.hq_accounts add constraint hq_active_connection_account_fk
 foreign key(id,active_connection_id) references public.hq_platform_connections(account_id,id) deferrable initially deferred;
create table hq_private.credential_secrets (
 vault_secret_id uuid primary key references vault.secrets(id), account_id uuid not null references public.hq_accounts(id),
 unique(account_id,vault_secret_id)
);
alter table hq_private.credential_secrets enable row level security;
alter table hq_private.credential_secrets force row level security;
revoke all on hq_private.credential_secrets from public, anon, authenticated;
create table hq_private.connection_credentials (
 account_id uuid not null, connection_id uuid not null, vault_secret_id uuid not null references vault.secrets(id),
 primary key(account_id,connection_id),
 foreign key(account_id,connection_id) references public.hq_platform_connections(account_id,id),
 foreign key(account_id,vault_secret_id) references hq_private.credential_secrets(account_id,vault_secret_id)
);
alter table hq_private.connection_credentials enable row level security;
alter table hq_private.connection_credentials force row level security;
revoke all on hq_private.connection_credentials from public, anon, authenticated;
create table public.hq_catalog_parts (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.hq_accounts(id),
 sku text not null check(length(sku) between 1 and 128), name text not null check(length(name) between 1 and 256),
 unit_price_cents bigint not null check(unit_price_cents between 0 and 9007199254740991),
 taxable boolean not null, revision integer not null default 1 check(revision>0), active boolean not null default true,
 unique(account_id,id), unique(account_id,sku)
);
alter table public.hq_catalog_parts enable row level security;
alter table public.hq_catalog_parts force row level security;
revoke all on public.hq_catalog_parts from public, anon, authenticated;
-- Internal cost and adapter references are not exposed by the Data API.
create table hq_private.part_costs (
 account_id uuid not null, part_id uuid not null, unit_cost_cents bigint not null check(unit_cost_cents between 0 and 9007199254740991),
 platform_reference jsonb, primary key(account_id,part_id),
 foreign key(account_id,part_id) references public.hq_catalog_parts(account_id,id)
);
alter table hq_private.part_costs enable row level security;
alter table hq_private.part_costs force row level security;
revoke all on hq_private.part_costs from public, anon, authenticated;
create table public.hq_inventory_locations (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.hq_accounts(id),
 name text not null, assigned_user_id uuid, unique(account_id,id),
 foreign key(account_id,assigned_user_id) references public.hq_memberships(account_id,user_id)
);
alter table public.hq_inventory_locations enable row level security;
alter table public.hq_inventory_locations force row level security;
revoke all on public.hq_inventory_locations from public, anon, authenticated;
create unique index hq_one_assigned_location on public.hq_inventory_locations(account_id,assigned_user_id) where assigned_user_id is not null;
create table public.hq_inventory_balances (
 account_id uuid not null, location_id uuid not null, part_id uuid not null,
 on_hand numeric(16,2) not null check(on_hand>=0), reserved numeric(16,2) not null default 0 check(reserved>=0 and reserved<=on_hand),
 primary key(account_id,location_id,part_id),
 foreign key(account_id,location_id) references public.hq_inventory_locations(account_id,id),
 foreign key(account_id,part_id) references public.hq_catalog_parts(account_id,id)
);
alter table public.hq_inventory_balances enable row level security;
alter table public.hq_inventory_balances force row level security;
revoke all on public.hq_inventory_balances from public, anon, authenticated;
create table hq_private.job_confirmations (
 id uuid primary key, account_id uuid not null, connection_id uuid not null, connection_version integer not null,
 owner_id uuid not null, scope text not null, job_id text not null, job_number text not null, expires_at timestamptz not null,
 unique(account_id,id), foreign key(account_id,owner_id) references public.hq_memberships(account_id,user_id),
 foreign key(account_id,connection_id) references public.hq_platform_connections(account_id,id)
);
alter table hq_private.job_confirmations enable row level security;
alter table hq_private.job_confirmations force row level security;
revoke all on hq_private.job_confirmations from public, anon, authenticated;
create table hq_private.material_quotes (
 id uuid primary key, account_id uuid not null, owner_id uuid not null, scope text not null,
 confirmation_id uuid not null, data jsonb not null, data_text text not null, expires_at timestamptz not null,
 unique(account_id,id), foreign key(account_id,confirmation_id) references hq_private.job_confirmations(account_id,id),
 foreign key(account_id,owner_id) references public.hq_memberships(account_id,user_id)
);
alter table hq_private.material_quotes enable row level security;
alter table hq_private.material_quotes force row level security;
revoke all on hq_private.material_quotes from public, anon, authenticated;
create table hq_private.material_submissions (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, connection_id uuid not null, connection_version integer not null,
 owner_id uuid not null, scope text not null, request_key text not null check(request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'), job_id text not null, job_number text not null,
 payload jsonb not null, state text not null check(state in ('reserved','dispatching','verification_pending','inventory_pending','confirmed','unknown','failed')),
 result jsonb, remote_material_id text, reservation_id uuid, error_code text,
 dispatched_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(account_id,id), unique(account_id,request_key),
 foreign key(account_id,owner_id) references public.hq_memberships(account_id,user_id),
 foreign key(account_id,connection_id) references public.hq_platform_connections(account_id,id)
);
alter table hq_private.material_submissions enable row level security;
alter table hq_private.material_submissions force row level security;
revoke all on hq_private.material_submissions from public, anon, authenticated;
create unique index hq_remote_material_once on hq_private.material_submissions(account_id,connection_id,remote_material_id)
 where remote_material_id is not null and not(payload ? 'update');
create unique index hq_one_material_operation on hq_private.material_submissions(account_id,connection_id,job_id,(payload->>'sku'))
 where state not in ('confirmed','failed');
create unique index hq_one_line_quantity_operation on hq_private.material_submissions(account_id,connection_id,job_id,(payload->'update'->>'materialId'))
 where payload ? 'update' and state not in ('confirmed','failed');
create table hq_private.inventory_reservations (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, submission_id uuid not null,
 location_id uuid not null, part_id uuid not null, quantity numeric(16,2) not null check(quantity>0),
 status text not null check(status in ('held','committed','released')), unique(account_id,id), unique(account_id,submission_id),
 foreign key(account_id,submission_id) references hq_private.material_submissions(account_id,id),
 foreign key(account_id,location_id,part_id) references public.hq_inventory_balances(account_id,location_id,part_id)
);
alter table hq_private.inventory_reservations enable row level security;
alter table hq_private.inventory_reservations force row level security;
revoke all on hq_private.inventory_reservations from public, anon, authenticated;
alter table hq_private.material_submissions add constraint hq_submission_reservation_fk
 foreign key(account_id,reservation_id) references hq_private.inventory_reservations(account_id,id) deferrable initially deferred;
create table public.hq_inventory_ledger (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, submission_id uuid not null,
 location_id uuid not null, part_id uuid not null, quantity_delta numeric(16,2) not null,
 action text not null check(action in ('material_commit','reservation_release')), created_at timestamptz not null default now(),
 unique(account_id,submission_id,action),
 foreign key(account_id,submission_id) references hq_private.material_submissions(account_id,id),
 foreign key(account_id,location_id,part_id) references public.hq_inventory_balances(account_id,location_id,part_id)
);
alter table public.hq_inventory_ledger enable row level security;
alter table public.hq_inventory_ledger force row level security;
revoke all on public.hq_inventory_ledger from public, anon, authenticated;
create table public.hq_audit_records (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.hq_accounts(id),
 actor_id uuid references public.hq_users(id), submission_id uuid, action text not null, details jsonb not null default '{}',
 created_at timestamptz not null default now(),
 foreign key(account_id,submission_id) references hq_private.material_submissions(account_id,id)
);
alter table public.hq_audit_records enable row level security;
alter table public.hq_audit_records force row level security;
revoke all on public.hq_audit_records from public, anon, authenticated;
create index hq_stuck_submissions on hq_private.material_submissions(state,updated_at) where state not in ('confirmed','failed');
create index hq_membership_user on public.hq_memberships(user_id,account_id) where active;

create function hq_private.enforce_connection() returns trigger language plpgsql set search_path=pg_catalog as $$
declare a public.hq_accounts; aid uuid; active_id uuid;
begin
 if tg_table_name='hq_accounts' then aid:=new.id;
 else aid:=coalesce(new.account_id,old.account_id); end if;
 select * into a from public.hq_accounts where id=aid;
 select id into active_id from public.hq_platform_connections where account_id=aid and status='active';
 if a.active_connection_id is distinct from active_id then raise exception 'ACTIVE_CONNECTION_MISMATCH'; end if;
 return null;
end $$;
create constraint trigger hq_account_connection_valid after insert or update on public.hq_accounts
 deferrable initially deferred for each row execute function hq_private.enforce_connection();
create constraint trigger hq_connection_pointer_valid after insert or update or delete on public.hq_platform_connections
 deferrable initially deferred for each row execute function hq_private.enforce_connection();

create function hq_private.prevent_unresolved_connection_change() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if (new.version,new.status,new.external_account_id,new.platform) is distinct from (old.version,old.status,old.external_account_id,old.platform)
 and exists(select 1 from hq_private.material_submissions where account_id=old.account_id and state not in ('confirmed','failed'))
 then raise exception 'CONNECTION_HAS_UNRESOLVED_SUBMISSIONS'; end if;
 return new;
end $$;
create trigger hq_block_connection_changes before update on public.hq_platform_connections
 for each row execute function hq_private.prevent_unresolved_connection_change();

create function hq_private.immutable_audit() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'APPEND_ONLY'; end $$;
create trigger hq_audit_append_only before update or delete on public.hq_audit_records for each row execute function hq_private.immutable_audit();
create trigger hq_ledger_append_only before update or delete on public.hq_inventory_ledger for each row execute function hq_private.immutable_audit();

revoke all on all functions in schema hq_private from public, anon, authenticated;
revoke all on schema vault from public, anon, authenticated;
revoke all on vault.secrets, vault.decrypted_secrets from public, anon, authenticated;
-- Native Vault owns internal crypto functions which postgres cannot administer.
-- They already deny client EXECUTE. Touch only functions with effective client
-- access; the exhaustive assertion below still refuses any remaining access.
for vault_function in
 select p.oid::regprocedure as signature
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='vault' and exists (
  select 1 from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated')
   and pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE'))
loop
 execute pg_catalog.format('revoke all on function %s from public, anon, authenticated',vault_function.signature);
end loop;

-- REVOKE can warn rather than fail when the migration role lacks grant options.
-- Refuse to publish any HQ objects if inherited/client Vault access remains.
if exists(select 1 from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated') and (
 pg_catalog.has_schema_privilege(r.oid,'vault','USAGE') or
 pg_catalog.has_table_privilege(r.oid,'vault.secrets','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
 pg_catalog.has_table_privilege(r.oid,'vault.decrypted_secrets','SELECT,INSERT,UPDATE,DELETE') or
 exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='vault' and pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE'))
)) then raise exception 'HQ_VAULT_CLIENT_ACCESS_NOT_REVOKED'; end if;

end;
$hq_migration$;

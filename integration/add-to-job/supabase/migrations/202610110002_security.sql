-- Atomic publication: no client can observe partially hardened objects.
do $hq_migration$
begin
create function hq_private.allowed(actor uuid, account uuid, action text) returns boolean
 language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.hq_memberships m join public.hq_users u on u.id=m.user_id
 where m.account_id=account and m.user_id=actor and m.active and not u.disabled and (
  (action in ('read','jobs:read','materials:read') and m.role in ('owner','admin','technician','viewer')) or
  (action in ('materials:create','materials:recover') and m.role in ('owner','admin','technician')) or
  (action in ('admin','materials:reconcile') and m.role in ('owner','admin'))));
$$;
create function hq_private.member(account uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select hq_private.allowed(auth.uid(),account,'read');
$$;
create function hq_private.administrator(account uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select hq_private.allowed(auth.uid(),account,'admin');
$$;
create function hq_private.assert_allowed(actor uuid, account uuid, action text) returns void
 language plpgsql security definer set search_path=pg_catalog as $$
begin if not hq_private.allowed(actor,account,action) then raise exception 'FORBIDDEN' using errcode='42501'; end if; end $$;

-- Explicit grants AND RLS. Users can read permitted data, never mutate the workflow directly.
do $$ declare t text; begin
 foreach t in array array['hq_accounts','hq_users','hq_memberships','hq_platform_connections','hq_catalog_parts',
 'hq_inventory_locations','hq_inventory_balances','hq_inventory_ledger','hq_audit_records'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
 foreach t in array array['credential_secrets','connection_credentials','part_costs','job_confirmations','material_quotes','material_submissions','inventory_reservations'] loop
  execute format('alter table hq_private.%I enable row level security',t);
  execute format('alter table hq_private.%I force row level security',t);
  execute format('revoke all on hq_private.%I from public,anon,authenticated',t);
 end loop;
end $$;
create policy hq_account_read on public.hq_accounts for select to authenticated using(hq_private.member(id));
create policy hq_user_read on public.hq_users for select to authenticated using(id=auth.uid() and not disabled);
create policy hq_membership_read on public.hq_memberships for select to authenticated
 using(hq_private.member(account_id) and (user_id=auth.uid() or hq_private.administrator(account_id)));
do $$ declare t text; begin
 foreach t in array array['hq_platform_connections','hq_catalog_parts','hq_inventory_locations','hq_inventory_balances','hq_inventory_ledger'] loop
 execute format('create policy hq_tenant_read on public.%I for select to authenticated using(hq_private.member(account_id))',t);
 end loop;
end $$;
create policy hq_audit_read on public.hq_audit_records for select to authenticated using(hq_private.administrator(account_id));
revoke all on all functions in schema hq_private from public,anon,authenticated;
grant usage on schema hq_private to authenticated;
grant execute on function hq_private.member(uuid), hq_private.administrator(uuid) to authenticated;
-- Secrets and internal costs remain private even to authenticated account administrators.
revoke all on vault.secrets, vault.decrypted_secrets from public,anon,authenticated;

end;
$hq_migration$;

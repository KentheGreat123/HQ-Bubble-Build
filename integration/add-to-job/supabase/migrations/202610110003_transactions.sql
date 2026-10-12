-- Atomic publication: no client can observe partially hardened objects.
do $hq_migration$
begin
-- Only the authenticated backend may execute this RPC. p_actor is derived from
-- Supabase Auth getUser(), never from request JSON or the frontend PIN.
create function public.hq_backend(p_actor uuid,p_account uuid,p_op text,p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare conn public.hq_platform_connections; c hq_private.job_confirmations; q hq_private.material_quotes;
 s hq_private.material_submissions; r hq_private.inventory_reservations; part public.hq_catalog_parts;
 loc public.hq_inventory_locations; bal public.hq_inventory_balances; cost hq_private.part_costs;
 key text:=p_args->>'key'; sc text:=p_args->>'scope'; scope_data jsonb; uid uuid; rid uuid;
 qty numeric; out_result jsonb; material jsonb; action text;
begin
 if p_actor is null or p_account is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_op='authorize' then return to_jsonb(hq_private.allowed(p_actor,p_account,p_args->>'action')); end if;
 -- Recording an already-authorized operation must survive a membership revocation
 -- after the remote write. These operations remain service-role-only and owner-bound.
 if p_op not in ('remote_created','verified','commit','complete','unknown','reject_update') then
  action:=case when p_op in ('claim','reserve','reserved','dispatching','save_quote','quote','part') then 'materials:create'
   when p_op in ('reconcile_get','reconcile_attach','reconcile_release','reconcile_commit','configure_connection') then 'admin'
   else 'read' end;
  perform hq_private.assert_allowed(p_actor,p_account,action);
 end if;
 -- All mutations share account -> connection/submission -> balance lock order.
 -- This also serializes connection rotation with new claims and avoids deadlocks
 -- between ledger audit inserts, stock commits and request-key contention.
 if p_op not in ('authorize','connection','part','credential','confirmation','quote','get','reconcile_get','material_ids') then
  perform 1 from public.hq_accounts where id=p_account for update;
 end if;
 if p_op='connection' then
  select f.* into conn from public.hq_accounts a join public.hq_platform_connections f
   on f.account_id=a.id and f.id=a.active_connection_id where a.id=p_account and a.materials_enabled and f.status='active';
  if conn.id is null then return null; end if;
  return jsonb_build_object('accountId',p_account,'id',conn.id,'platform',conn.platform,'externalAccountId',conn.external_account_id,'version',conn.version);
 end if;
 if p_op='part' then
  select * into part from public.hq_catalog_parts where account_id=p_account and sku=p_args->>'sku' and active;
  select * into cost from hq_private.part_costs where account_id=p_account and part_id=part.id;
  if part.id is null or cost.part_id is null then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object('accountId',p_account,'sku',part.sku,'name',part.name,
   'unitPriceCents',part.unit_price_cents,'unitCostCents',cost.unit_cost_cents,'taxable',part.taxable,'platformReference',cost.platform_reference));
 end if;
 if p_op='material_ids' then
  return coalesce((select jsonb_agg(distinct jsonb_build_object('id',remote_material_id,'sku',payload->>'sku')) from hq_private.material_submissions
   where account_id=p_account and connection_id=(((p_args->>'scope')::jsonb)->>1)::uuid
   and job_id=p_args->>'jobId' and remote_material_id is not null),'[]');
 end if;
 if p_op='credential' then
  select * into conn from public.hq_platform_connections where account_id=p_account and id=(p_args->>'connectionId')::uuid
   and version=(p_args->>'version')::integer and status='active';
  if conn.id is null then raise exception 'CONNECTION_CHANGED'; end if;
  select v.decrypted_secret into key from hq_private.connection_credentials b join vault.decrypted_secrets v on v.id=b.vault_secret_id
   where b.account_id=p_account and b.connection_id=conn.id;
  if key is null then raise exception 'SERVER_CREDENTIAL_UNAVAILABLE'; end if;
  return to_jsonb(key);
 end if;
 if p_op='configure_connection' then
  -- Vault secret is created separately by an approved administrator. No plaintext
  -- credential travels through this RPC, SQL migration, frontend or APK.
  perform 1 from public.hq_accounts where id=p_account for update;
  if exists(select 1 from hq_private.material_submissions where account_id=p_account and state not in ('confirmed','failed'))
   then raise exception 'CONNECTION_HAS_UNRESOLVED_SUBMISSIONS'; end if;
  uid:=(p_args->>'connectionId')::uuid;
  select * into conn from public.hq_platform_connections where account_id=p_account and id=uid for update;
  if conn.id is null then raise exception 'PLATFORM_NOT_CONNECTED'; end if;
  if conn.platform<>'housecallpro' then raise exception 'PLATFORM_NOT_IMPLEMENTED'; end if;
  if p_args->>'activate'='true' and p_args->>'companyVerified' is distinct from 'true' then raise exception 'COMPANY_NOT_VERIFIED'; end if;
  update public.hq_platform_connections set status='inactive' where account_id=p_account and status='active';
  update public.hq_platform_connections set version=version+1,status=case when p_args->>'activate'='true' then 'active' else 'inactive' end
   where account_id=p_account and id=uid;
  insert into hq_private.connection_credentials values(p_account,uid,(p_args->>'vaultSecretId')::uuid)
   on conflict(account_id,connection_id) do update set vault_secret_id=excluded.vault_secret_id;
  update public.hq_accounts set active_connection_id=case when p_args->>'activate'='true' then uid else null end,
   materials_enabled=(p_args->>'activate'='true') where id=p_account;
  insert into public.hq_audit_records(account_id,actor_id,action,details) values(p_account,p_actor,'connection_configured',jsonb_build_object('connectionId',uid));
  return jsonb_build_object('configured',true);
 end if;
 if p_op in ('confirmation','quote') then
  if p_op='confirmation' then
   select * into c from hq_private.job_confirmations where id=(p_args->>'id')::uuid and account_id=p_account and owner_id=p_actor;
   if c.id is null then return null; end if;
   return jsonb_build_object('id',c.id,'scope',c.scope,'job_id',c.job_id,'job_number',c.job_number,'expires_at',extract(epoch from c.expires_at)*1000);
  end if;
  select * into q from hq_private.material_quotes where id=(p_args->>'id')::uuid and account_id=p_account and owner_id=p_actor;
  if q.id is null then return null; end if;
  return jsonb_build_object('id',q.id,'scope',q.scope,'data',q.data_text,'expires_at',extract(epoch from q.expires_at)*1000);
 end if;
 if p_op in ('save_confirmation','save_quote') then
  scope_data:=(p_args->>'scope')::jsonb;
  if jsonb_array_length(scope_data)<>2 or scope_data->>1<>p_actor::text then raise exception 'FORBIDDEN'; end if;
  scope_data:=(scope_data->>0)::jsonb;
  select f.* into conn from public.hq_accounts a join public.hq_platform_connections f on f.account_id=a.id and f.id=a.active_connection_id
   where a.id=p_account and a.materials_enabled and f.status='active' for update of f;
  if conn.id is null or scope_data<>jsonb_build_array(p_account::text,conn.id::text,conn.version) then raise exception 'CONNECTION_CHANGED'; end if;
  if p_op='save_confirmation' then
   if to_timestamp((p_args->>'expiresAt')::numeric/1000)<=now() or to_timestamp((p_args->>'expiresAt')::numeric/1000)>now()+interval '10 minutes 5 seconds'
    then raise exception 'INVALID_CONFIRMATION'; end if;
   insert into hq_private.job_confirmations values((p_args->>'id')::uuid,p_account,conn.id,conn.version,p_actor,p_args->>'scope',
    p_args->>'jobId',p_args->>'jobNumber',to_timestamp((p_args->>'expiresAt')::numeric/1000));
  else
   material:=p_args->'data';
   select * into c from hq_private.job_confirmations where id=(material->>'confirmationId')::uuid and account_id=p_account and owner_id=p_actor;
   if c.id is null or c.scope<>p_args->>'scope' or c.expires_at<=now() then raise exception 'INVALID_CONFIRMATION'; end if;
   if (p_args->>'dataText')::jsonb is distinct from material then raise exception 'INVALID_QUOTE'; end if;
   if to_timestamp((p_args->>'expiresAt')::numeric/1000)<=now() or to_timestamp((p_args->>'expiresAt')::numeric/1000)>now()+interval '5 minutes 5 seconds'
    then raise exception 'INVALID_QUOTE'; end if;
   insert into hq_private.material_quotes values((p_args->>'id')::uuid,p_account,p_actor,p_args->>'scope',c.id,material,p_args->>'dataText',
    to_timestamp((p_args->>'expiresAt')::numeric/1000));
  end if;
  return 'true';
 end if;
 -- Every submission operation is account-bound; no arbitrary row or actor ID from a client.
 if p_op in ('get','reconcile_get') then
  select * into s from hq_private.material_submissions where account_id=p_account and request_key=key;
  if s.id is null then return null; end if;
  if p_op='get' and s.owner_id<>p_actor then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('scope',s.scope,'owner_id',s.owner_id,'fingerprint',s.fingerprint,'state',s.state,
   'connection_id',s.connection_id,'connection_version',s.connection_version,'job_id',s.job_id,'job_number',s.job_number,
   'result',case when s.result is null then null else s.result::text end,'payload',s.payload::text,'reservation_id',s.reservation_id);
 end if;
 if p_op='claim' then
  -- Lock the connection first, then the request row/balance. Switching connections
  -- takes the same lock order and cannot race an unfinished operation into existence.
  select f.* into conn from public.hq_accounts a join public.hq_platform_connections f on f.account_id=a.id and f.id=a.active_connection_id
   where a.id=p_account and a.materials_enabled and f.status='active' for update of f;
  if conn.id is null or conn.id<>(p_args->>'connectionId')::uuid or conn.version<>(p_args->>'connectionVersion')::integer
   or (sc::jsonb)<>jsonb_build_array(p_account::text,conn.id::text,conn.version) then raise exception 'CONNECTION_CHANGED'; end if;
  select * into s from hq_private.material_submissions where account_id=p_account and request_key=key for update;
  if s.id is not null then
   if s.owner_id<>p_actor then raise exception 'FORBIDDEN'; end if;
   if s.fingerprint<>p_args->>'fingerprint' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return jsonb_build_object('claimed',false,'state',s.state);
  end if;
  if exists(select 1 from hq_private.material_submissions where account_id=p_account and connection_id=conn.id
   and job_id=p_args->>'jobId' and payload->>'sku'=p_args->'payload'->>'sku' and state not in ('confirmed','failed'))
   then raise exception 'MATERIAL_OPERATION_IN_PROGRESS'; end if;
  select * into c from hq_private.job_confirmations where id=(p_args->>'confirmationId')::uuid and account_id=p_account and owner_id=p_actor;
  select * into q from hq_private.material_quotes where id=(p_args->>'quoteId')::uuid and account_id=p_account and owner_id=p_actor;
  material:=p_args->'payload';
  if c.id is null or c.expires_at<=now() or c.connection_id<>conn.id or c.connection_version<>conn.version or c.job_id<>p_args->>'jobId'
   then raise exception 'INVALID_CONFIRMATION'; end if;
  if q.id is null or q.confirmation_id<>c.id or q.expires_at<=now() or q.data->'material' is distinct from material then raise exception 'INVALID_QUOTE'; end if;
  if material is null or not(material ?& array['sku','name','description','quantity','unitPriceCents','unitCostCents','taxable']) then raise exception 'INVALID_REQUEST'; end if;
  qty:=(material->>'quantity')::numeric;
  if qty<=0 or qty<>round(qty,2) then raise exception 'INVALID_REQUEST'; end if;
  select * into part from public.hq_catalog_parts where account_id=p_account and sku=material->>'sku' and active for share;
  select * into cost from hq_private.part_costs where account_id=p_account and part_id=part.id for share;
  if part.id is null or cost.part_id is null then raise exception 'PART_UNAVAILABLE'; end if;
  if not(material ? 'update') and (part.name<>material->>'name' or ('Part # '||part.sku)<>material->>'description' or
   part.unit_price_cents<>(material->>'unitPriceCents')::bigint or cost.unit_cost_cents<>(material->>'unitCostCents')::bigint or
   part.taxable<>(material->>'taxable')::boolean or cost.platform_reference is distinct from material->'platformReference')
   then raise exception 'PRICE_OR_SELECTION_CHANGED'; end if;
  if material ? 'update' and (coalesce(material->'update'->>'materialId','')='' or
   (material->'update'->>'newQuantity')::numeric is distinct from (material->'update'->>'existingQuantity')::numeric+qty)
   then raise exception 'MATERIAL_UPDATE_UNAVAILABLE'; end if;
  select * into loc from public.hq_inventory_locations where account_id=p_account and assigned_user_id=p_actor for share;
  select * into bal from public.hq_inventory_balances where account_id=p_account and location_id=loc.id and part_id=part.id for update;
  uid:=gen_random_uuid();
  if bal.location_id is null or bal.on_hand-bal.reserved<qty then
   insert into hq_private.material_submissions(id,account_id,connection_id,connection_version,owner_id,scope,request_key,fingerprint,job_id,job_number,payload,state,error_code)
    values(uid,p_account,conn.id,conn.version,p_actor,sc,key,p_args->>'fingerprint',c.job_id,c.job_number,material,'failed','INSUFFICIENT_INVENTORY');
   insert into public.hq_audit_records(account_id,actor_id,submission_id,action) values(p_account,p_actor,uid,'insufficient_inventory');
   return jsonb_build_object('claimed',false,'error','INSUFFICIENT_INVENTORY');
  end if;
  rid:=gen_random_uuid();
  insert into hq_private.material_submissions(id,account_id,connection_id,connection_version,owner_id,scope,request_key,fingerprint,job_id,job_number,payload,state,reservation_id)
   values(uid,p_account,conn.id,conn.version,p_actor,sc,key,p_args->>'fingerprint',c.job_id,c.job_number,material,'reserved',rid);
  update public.hq_inventory_balances set reserved=reserved+qty where account_id=p_account and location_id=loc.id and part_id=part.id;
  insert into hq_private.inventory_reservations values(rid,p_account,uid,loc.id,part.id,qty,'held');
  insert into public.hq_audit_records(account_id,actor_id,submission_id,action) values(p_account,p_actor,uid,'inventory_reserved');
  return jsonb_build_object('claimed',true,'reservationId',rid);
 end if;
 if p_op='dispatching' then
  select f.* into conn from public.hq_accounts a join public.hq_platform_connections f on f.account_id=a.id and f.id=a.active_connection_id
   where a.id=p_account and a.materials_enabled and f.status='active' for update of f;
 end if;
 select * into s from hq_private.material_submissions where account_id=p_account and request_key=key for update;
 if s.id is null then raise exception 'SUBMISSION_NOT_FOUND'; end if;
 if p_op in ('reconcile_attach','reconcile_release','reconcile_commit') then
  perform hq_private.assert_allowed(p_actor,p_account,'materials:reconcile');
  if length(coalesce(p_args->>'evidence','')) not between 10 and 2000 then raise exception 'RECONCILIATION_EVIDENCE_REQUIRED'; end if;
 else
  if s.owner_id<>p_actor or (sc is not null and sc<>s.scope) then raise exception 'FORBIDDEN'; end if;
 end if;
 if p_op in ('reserve','reserved') then
  if s.reservation_id is null or s.state<>'reserved' then raise exception 'SUBMISSION_UNKNOWN'; end if;
  return to_jsonb(s.reservation_id::text);
 end if;
 if p_op='dispatching' then
  if conn.id is null or conn.id<>s.connection_id or conn.version<>s.connection_version then raise exception 'CONNECTION_CHANGED'; end if;
  if s.state<>'reserved' then raise exception 'SUBMISSION_UNKNOWN'; end if;
  select * into part from public.hq_catalog_parts where account_id=p_account and sku=s.payload->>'sku' and active for share;
  select * into cost from hq_private.part_costs where account_id=p_account and part_id=part.id for share;
  if part.id is null or cost.part_id is null or (not(s.payload ? 'update') and (part.name is distinct from s.payload->>'name' or
   to_jsonb(part.unit_price_cents) is distinct from s.payload->'unitPriceCents' or
   to_jsonb(cost.unit_cost_cents) is distinct from s.payload->'unitCostCents' or
   to_jsonb(part.taxable) is distinct from s.payload->'taxable' or cost.platform_reference is distinct from s.payload->'platformReference'))
   then raise exception 'PRICE_OR_SELECTION_CHANGED'; end if;
  update hq_private.material_submissions set state='dispatching',dispatched_at=now(),updated_at=now() where id=s.id;
 elsif p_op='remote_created' then
  out_result:=p_args->'result';
  if s.state<>'dispatching' or coalesce(out_result->'material'->>'id','')='' or out_result->>'jobId' is distinct from s.job_id
   then raise exception 'SUBMISSION_UNKNOWN'; end if;
  update hq_private.material_submissions set state='verification_pending',result=out_result,
   remote_material_id=out_result->'material'->>'id',updated_at=now() where id=s.id;
 elsif p_op in ('verified','reconcile_attach') then
  out_result:=p_args->'result'; material:=out_result->'material';
  if (p_op='verified' and s.state<>'verification_pending') or
   (p_op='reconcile_attach' and s.state not in ('dispatching','verification_pending','unknown','inventory_pending')) or
   coalesce(material->>'id','')='' or out_result->>'jobId' is distinct from s.job_id or
   (s.payload ? 'update' and material->>'id' is distinct from s.payload->'update'->>'materialId') or
   (s.remote_material_id is not null and s.remote_material_id is distinct from material->>'id') or
   material->>'name' is distinct from s.payload->>'name' or material->>'description' is distinct from s.payload->>'description' or
   material->>'kind' is distinct from 'materials' or material->'quantity' is distinct from coalesce(s.payload->'update'->'newQuantity',s.payload->'quantity') or
   material->'unitPriceCents' is distinct from s.payload->'unitPriceCents' or
   material->'unitCostCents' is distinct from s.payload->'unitCostCents' or material->'taxable' is distinct from s.payload->'taxable'
   then raise exception 'MATERIAL_VERIFICATION_FAILED'; end if;
  update hq_private.material_submissions set state='inventory_pending',result=out_result,
   remote_material_id=material->>'id',updated_at=now() where id=s.id;
 elsif p_op in ('commit','complete','reconcile_commit') then
  if s.state='confirmed' then return s.result; end if;
  if s.state<>'inventory_pending' or s.remote_material_id is null then raise exception 'MATERIAL_NOT_VERIFIED'; end if;
  select * into r from hq_private.inventory_reservations where account_id=p_account and id=s.reservation_id for update;
  if r.status<>'held' then raise exception 'INVENTORY_RESERVATION_UNKNOWN'; end if;
  perform 1 from public.hq_inventory_balances where account_id=p_account and location_id=r.location_id and part_id=r.part_id for update;
  update public.hq_inventory_balances set on_hand=on_hand-r.quantity,reserved=reserved-r.quantity
   where account_id=p_account and location_id=r.location_id and part_id=r.part_id;
  insert into public.hq_inventory_ledger(account_id,submission_id,location_id,part_id,quantity_delta,action)
   values(p_account,s.id,r.location_id,r.part_id,-r.quantity,'material_commit');
  update hq_private.inventory_reservations set status='committed' where id=r.id;
  out_result:=s.result||jsonb_build_object('status','confirmed');
  update hq_private.material_submissions set state='confirmed',result=out_result,updated_at=now() where id=s.id;
  insert into public.hq_audit_records(account_id,actor_id,submission_id,action) values(p_account,p_actor,s.id,'material_confirmed');
  return out_result;
 elsif p_op='unknown' then
  if s.state in ('reserved','dispatching') then
   update hq_private.material_submissions set state='unknown',updated_at=now() where id=s.id;
  end if;
 elsif p_op in ('reconcile_release','cancel_undispatched','reject_update') then
  -- Never release a dispatched/unknown hold based only on a claimed absence from
  -- a GET response. Only provably undispatched 'reserved' operations may be released.
  if p_op='reject_update' then
   if s.state<>'dispatching' or not(s.payload ? 'update') or s.remote_material_id is not null or
    p_args->>'reason' not in ('MATERIAL_UPDATE_NOT_AUTHORIZED','MATERIAL_UPDATE_UNAVAILABLE','MATERIAL_UPDATE_REJECTED','EXISTING_MATERIAL_CHANGED','PART_IDENTITY_UNVERIFIED','MULTIPLE_MATERIAL_MATCHES') or p_args->>'reason' is null
    then raise exception 'MANUAL_RECONCILIATION_REQUIRED'; end if;
  elsif s.state not in ('reserved','unknown') or s.dispatched_at is not null or s.remote_material_id is not null then raise exception 'MANUAL_RECONCILIATION_REQUIRED'; end if;
  select * into r from hq_private.inventory_reservations where account_id=p_account and id=s.reservation_id for update;
  if r.status<>'held' then raise exception 'INVENTORY_RESERVATION_UNKNOWN'; end if;
  update public.hq_inventory_balances set reserved=reserved-r.quantity where account_id=p_account and location_id=r.location_id and part_id=r.part_id;
  update hq_private.inventory_reservations set status='released' where id=r.id;
  update hq_private.material_submissions set state='failed',error_code=case when p_op='reject_update' then p_args->>'reason' else 'RECONCILED_UNDISPATCHED' end,updated_at=now() where id=s.id;
  insert into public.hq_inventory_ledger(account_id,submission_id,location_id,part_id,quantity_delta,action)
   values(p_account,s.id,r.location_id,r.part_id,0,'reservation_release');
 else raise exception 'NOT_FOUND'; end if;
 insert into public.hq_audit_records(account_id,actor_id,submission_id,action,details)
  values(p_account,p_actor,s.id,p_op,case when p_op like 'reconcile_%' then jsonb_build_object('evidence',p_args->>'evidence') else '{}' end);
 return 'true';
end $$;
revoke all on function public.hq_backend(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.hq_backend(uuid,uuid,text,jsonb) to service_role;
-- Default function EXECUTE is public in Postgres: revoke it on every private helper.
revoke all on all functions in schema hq_private from public,anon;

end;
$hq_migration$;

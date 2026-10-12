import {requireValue} from './errors.mjs';

/** Administrator-only reconciliation. No creation retry, bulk replacement,
 * deletion or release of a possibly-dispatched remote operation is supported.
 */
export async function reconcileMaterial({rpc,registry},input) {
  requireValue(input && Object.keys(input).every(k=>['idempotencyKey','action','materialId','evidence'].includes(k)) &&
    typeof input.idempotencyKey==='string' && /^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey) &&
    typeof input.evidence==='string' && input.evidence.trim().length>=10 && input.evidence.length<=2000);
  requireValue(await rpc('authorize',{action:'materials:reconcile'}),'FORBIDDEN',403);
  const row=await rpc('reconcile_get',{key:input.idempotencyKey});requireValue(row,'SUBMISSION_NOT_FOUND',404);
  if(row.state==='confirmed')return JSON.parse(row.result);
  const args={key:input.idempotencyKey,evidence:input.evidence};
  if(input.action==='release_undispatched') {
    await rpc('reconcile_release',args);return{status:'failed',reason:'RECONCILED_UNDISPATCHED'};
  }
  requireValue(input.action==='verify_existing' && typeof input.materialId==='string' && input.materialId.length>0 && input.materialId.length<=256);
  requireValue(['dispatching','unknown','verification_pending','inventory_pending'].includes(row.state),'MANUAL_RECONCILIATION_REQUIRED',409);
  const connection=await rpc('connection');
  requireValue(connection?.id===row.connection_id && connection.version===row.connection_version,'CONNECTION_CHANGED',409);
  const adapter=registry.forConnection(connection);
  const verified=await adapter.verifyMaterial(row.job_id,input.materialId,JSON.parse(row.payload));
  const result={status:'inventory_pending',jobId:row.job_id,jobNumber:row.job_number,material:verified};
  await rpc('reconcile_attach',{...args,result});
  // SQL commits stock, ledger and confirmed status atomically; if it fails the
  // durable inventory_pending record supports another authorized recovery.
  try{return await rpc('reconcile_commit',args);}catch{return result;}
}

import { IntegrationError, requireValue } from './errors.mjs';

const safeCodes = new Set(['FORBIDDEN','PLATFORM_NOT_CONNECTED','PLATFORM_NOT_IMPLEMENTED','CONNECTION_CHANGED',
 'CONNECTION_HAS_UNRESOLVED_SUBMISSIONS','SERVER_CREDENTIAL_UNAVAILABLE','INVALID_CONFIRMATION','INVALID_QUOTE',
 'INVALID_REQUEST','PART_UNAVAILABLE','PRICE_OR_SELECTION_CHANGED','IDEMPOTENCY_CONFLICT','INSUFFICIENT_INVENTORY',
 'SUBMISSION_UNKNOWN','SUBMISSION_NOT_FOUND','MATERIAL_VERIFICATION_FAILED','MATERIAL_NOT_VERIFIED',
 'INVENTORY_RESERVATION_UNKNOWN','MANUAL_RECONCILIATION_REQUIRED','RECONCILIATION_EVIDENCE_REQUIRED','COMPANY_NOT_VERIFIED',
 'MATERIAL_OPERATION_IN_PROGRESS','MATERIAL_UPDATE_UNAVAILABLE']);

/** Server-only PostgREST RPC transport. Never initialize with a browser key.
 * Every call carries the Auth-verified actor and account; SQL rechecks membership.
 */
export function createBackendRpc(admin, principal) {
  requireValue(admin?.rpc && principal?.id && principal?.accountId);
  return async (op, args = {}) => {
    const { data, error } = await admin.rpc('hq_backend', {p_actor:principal.id,p_account:principal.accountId,p_op:op,p_args:args});
    if (error) {
      const code = safeCodes.has(error.message) ? error.message : 'DATABASE_OPERATION_FAILED';
      throw new IntegrationError(code, code==='FORBIDDEN'?403:code==='DATABASE_OPERATION_FAILED'?503:409);
    }
    return data;
  };
}

/** Asynchronous persistence; claim+stock hold and commit+ledger+confirmation are
 * each one PostgreSQL transaction. SQLite remains a separate regression adapter.
 */
export class PostgresSubmissionStore {
  constructor({rpc,principal}) { this.rpc=rpc;this.principal=principal; }
  async connection(accountId) { requireValue(accountId===this.principal.accountId,'FORBIDDEN',403);return this.rpc('connection'); }
  saveConfirmation(c) {return this.rpc('save_confirmation',c);}
  getConfirmation(id) {return this.rpc('confirmation',{id});}
  saveQuote(q) {return this.rpc('save_quote',{...q,dataText:JSON.stringify(q.data)});}
  quote(id) {return this.rpc('quote',{id});}
  get(scope,key) {return this.rpc('get',{scope,key});}
  materialIds(scope,jobId,sku) {return this.rpc('material_ids',{scope,jobId,sku});}
  cancelUndispatched(scope,key) {return this.rpc('cancel_undispatched',{scope,key});}
  rejectUpdate(scope,key,reason) {return this.rpc('reject_update',{scope,key,reason});}
  async claim(scope,key,fingerprint,jobId,payload,metadata) {
    requireValue(metadata.accountId===this.principal.accountId && metadata.ownerId===this.principal.id,'FORBIDDEN',403);
    const r=await this.rpc('claim',{scope,key,fingerprint,jobId,payload,...metadata});
    if(r.error)throw new IntegrationError(r.error,409);
    return r.claimed;
  }
  reserved(scope,key) {return this.rpc('reserved',{scope,key});}
  dispatching(scope,key) {return this.rpc('dispatching',{scope,key});}
  remoteCreated(scope,key,result) {return this.rpc('remote_created',{scope,key,result});}
  materialCreated(scope,key,result) {return this.rpc('verified',{scope,key,result});}
  complete(scope,key) {return this.rpc('complete',{scope,key});}
  unknown(scope,key) {return this.rpc('unknown',{scope,key});}
}

export class PostgresInventory {
  constructor({rpc,principal}) {this.rpc=rpc;this.principal=principal;}
  operation(input) {
    requireValue(input.accountId===this.principal.accountId,'FORBIDDEN',403);
    let data;try{data=JSON.parse(input.operationId);}catch{throw new IntegrationError('INVALID_REQUEST');}
    requireValue(Array.isArray(data)&&data.length===2&&typeof data[0]==='string'&&typeof data[1]==='string');
    return {scope:data[0],key:data[1]};
  }
  reserve(input) {return this.rpc('reserve',this.operation(input));}
  commit(input) {return this.rpc('commit',this.operation(input));}
}

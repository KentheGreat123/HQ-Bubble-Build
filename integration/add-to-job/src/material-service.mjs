const randomUUID = () => globalThis.crypto.randomUUID();
async function fingerprintOf(value) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
import { IntegrationError, requireValue } from './errors.mjs';

/** Shared workflow: no vendor endpoints, authentication headers or wire fields. */
export class MaterialService {
  constructor({ registry, store, authorizeAction, authorizeJob, getPart, inventory, now = Date.now }) {
    requireValue(registry && store && typeof authorizeAction === 'function' &&
      typeof authorizeJob === 'function' && typeof getPart === 'function' && inventory &&
      ['reserve', 'commit'].every(k => typeof inventory[k] === 'function'));
    Object.assign(this, { registry, store, authorizeAction, authorizeJob, getPart, inventory, now });
  }
  async context(principal, action) {
    requireValue(principal && typeof principal.id === 'string' && principal.id.length > 0 &&
      typeof principal.accountId === 'string' && principal.accountId.length > 0 &&
      await this.authorizeAction(principal, action), 'FORBIDDEN', 403);
    const connection = await this.store.connection(principal.accountId);
    requireValue(connection, 'PLATFORM_NOT_CONNECTED', 409);
    const scope = JSON.stringify([principal.accountId, connection.id, connection.version]);
    return { connection, scope, userScope: JSON.stringify([scope, principal.id]),
      adapter: this.registry.forConnection(connection) };
  }
  async checkJob(principal, job) {
    requireValue(job && await this.authorizeJob(principal, job), 'FORBIDDEN', 403);
    requireValue(job.available === true, 'JOB_UNAVAILABLE', 409);
  }
  async resolveJob(principal, number) {
    const { adapter, userScope } = await this.context(principal, 'jobs:read');
    requireValue(typeof number === 'string' && number.length > 0 && number.length <= 64);
    const matches = await adapter.findJobsByNumber(number);
    requireValue(matches.length > 0, 'JOB_NOT_FOUND', 404);
    requireValue(matches.length === 1, 'AMBIGUOUS_JOB', 409);
    const job = matches[0]; await this.checkJob(principal, job);
    const confirmationId = randomUUID();
    await this.store.saveConfirmation({ id: confirmationId, scope: userScope, jobId: job.id,
      jobNumber: number, expiresAt: this.now() + 10 * 60 * 1000 });
    return { confirmationId, job };
  }
  quantity(quantity) {
    const q = String(quantity), count = Number(q);
    requireValue((typeof quantity === 'string' || typeof quantity === 'number') &&
      /^\d+(?:\.\d{1,2})?$/.test(q) && count > 0 && Number.isSafeInteger(Math.round(count * 100)));
    return count;
  }
  async selection(principal, context, confirmationId, sku) {
    const c = await this.store.getConfirmation(confirmationId);
    requireValue(c && c.scope === context.userScope && c.expires_at > this.now(), 'INVALID_CONFIRMATION', 409);
    const job = await context.adapter.getJob(c.job_id);
    requireValue(job?.id === c.job_id && job.jobNumber === c.job_number, 'JOB_CHANGED', 409);
    await this.checkJob(principal, job);
    const part = await this.getPart(sku, principal, context.connection);
    requireValue(part && part.sku === sku && part.accountId === principal.accountId &&
      typeof part.name === 'string' && part.name.trim().length > 0, 'PART_UNAVAILABLE', 409);
    requireValue(Number.isSafeInteger(part.unitPriceCents) && part.unitPriceCents >= 0 &&
      Number.isSafeInteger(part.unitCostCents) && part.unitCostCents >= 0 && typeof part.taxable === 'boolean',
      'CATALOG_INVALID', 503);
    return { c, job, part };
  }
  fields(input, keys) {
    requireValue(input && typeof input === 'object' && !Array.isArray(input) &&
      Object.keys(input).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(input, k)));
    requireValue(typeof input.confirmationId === 'string' && typeof input.sku === 'string' &&
      input.sku.length > 0 && input.sku.length <= 128);
  }
  material(part, quantity) {
    return { sku: part.sku, name: part.name, description: `Part # ${part.sku}`, quantity,
      unitPriceCents: part.unitPriceCents, unitCostCents: part.unitCostCents, taxable: part.taxable,
      ...(part.platformReference ? { platformReference: part.platformReference } : {}) };
  }
  async prepareMaterial(principal, input) {
    this.fields(input, ['confirmationId', 'sku', 'quantity']);
    const context = await this.context(principal, 'materials:create'), quantity = this.quantity(input.quantity);
    const { part,job } = await this.selection(principal, context, input.confirmationId, input.sku);
    let material = this.material(part, quantity);const quoteId = randomUUID();
    const known=await this.store.materialIds(context.scope,job.id,input.sku);
    const existing=await context.adapter.inspectMaterial(job.id,material,known);
    if(existing)material={...material,name:existing.name,description:existing.description,unitPriceCents:existing.unitPriceCents,
      unitCostCents:existing.unitCostCents,taxable:existing.taxable,
      update:{materialId:existing.id,existingQuantity:existing.quantity,newQuantity:existing.newQuantity,snapshot:existing.snapshot}};
    await this.store.saveQuote({ id: quoteId, scope: context.userScope,
      data: { confirmationId: input.confirmationId, material }, expiresAt: this.now() + 5 * 60 * 1000 });
    // Cost and vendor references stay server-side. Invoice totals/tax are platform-owned.
    return { quoteId, sku: input.sku, name: part.name, quantity, unitPriceCents: material.unitPriceCents,
      taxable: material.taxable, expiresAt: this.now() + 5 * 60 * 1000,
      operation:existing?'update':'create',...(existing?{existingMaterialId:existing.id,existingQuantity:existing.quantity,newQuantity:existing.newQuantity}:{}),jobNumber:job.jobNumber };
  }
  async replay(principal, scope, key, fingerprint) {
    const old = await this.store.get(scope, key);
    if (!old) return null;
    requireValue(old.owner_id === principal.id, 'FORBIDDEN', 403);
    requireValue(old.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', 409);
    if (['inventory_pending', 'verification_pending'].includes(old.state)) return { ...JSON.parse(old.result), status: old.state };
    requireValue(old.state !== 'failed', 'SUBMISSION_FAILED', 409);
    requireValue(old.state === 'confirmed', 'SUBMISSION_UNKNOWN', 409);
    return JSON.parse(old.result);
  }
  async finishInventory(principal, context, key, result, reservationId) {
    try {
      // Inventory implementation must durably deduplicate this account-scoped operation.
      await this.inventory.commit({ accountId: principal.accountId, operationId: JSON.stringify([context.scope, key]),
        reservationId, materialId: result.material.id });
      const confirmed = { ...result, status: 'confirmed' };
      await this.store.complete(context.scope, key, confirmed);
      return confirmed;
    } catch { return { ...result, status: 'inventory_pending' }; }
  }
  async addMaterial(principal, input) {
    const context = await this.context(principal, 'materials:create');
    this.fields(input, ['confirmationId', 'quoteId', 'sku', 'quantity', 'idempotencyKey',
      ...(Object.hasOwn(input||{},'confirmQuantityUpdate')?['confirmQuantityUpdate']:[])]);
    const { confirmationId, quoteId, sku, idempotencyKey } = input, count = this.quantity(input.quantity);
    requireValue(typeof quoteId === 'string' && typeof idempotencyKey === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey));
    const fingerprint = await fingerprintOf([confirmationId, quoteId, sku, count,input.confirmQuantityUpdate===true]);
    const previous = await this.replay(principal, context.scope, idempotencyKey, fingerprint);
    if (previous) return previous;
    const { c, job, part } = await this.selection(principal, context, confirmationId, sku);
    let material = this.material(part, count);const quote = await this.store.quote(quoteId);
    requireValue(quote && quote.scope === context.userScope && quote.expires_at > this.now(), 'INVALID_QUOTE', 409);
    const quoted=JSON.parse(quote.data);
    if(quoted.material?.update){
      requireValue(input.confirmQuantityUpdate===true,'QUANTITY_UPDATE_CONFIRMATION_REQUIRED',409);
      requireValue(quoted.confirmationId===confirmationId && quoted.material.sku===sku && quoted.material.quantity===count,'PRICE_OR_SELECTION_CHANGED',409);
      material=quoted.material;
    }else{
      requireValue(input.confirmQuantityUpdate===undefined,'INVALID_REQUEST');
      requireValue(quote.data === JSON.stringify({ confirmationId, material }), 'PRICE_OR_SELECTION_CHANGED', 409);
    }
    const known=await this.store.materialIds(context.scope,job.id,sku);
    await context.adapter.recheckMaterial(job.id,material,known);
    if (!await this.store.claim(context.scope, idempotencyKey, fingerprint, job.id, material,
      { accountId: principal.accountId, ownerId: principal.id, connectionId: context.connection.id,
        connectionVersion: context.connection.version, confirmationId, quoteId })) return this.replay(principal, context.scope, idempotencyKey, fingerprint);
    let reservationId;
    try {
      reservationId = await this.inventory.reserve({ accountId: principal.accountId,
        operationId: JSON.stringify([context.scope, idempotencyKey]), sku, quantity: count });
      requireValue(typeof reservationId === 'string' && reservationId.length > 0, 'INVENTORY_UNAVAILABLE', 409);
      await this.store.reserved(context.scope, idempotencyKey, reservationId);
    } catch {
      // Reserve may itself have committed before a timeout. Hold for reconciliation.
      await this.store.unknown(context.scope, idempotencyKey);
      throw new IntegrationError('INVENTORY_RESERVATION_UNKNOWN', 409);
    }
    // Repeat the absence/snapshot check after durable claim serialization. A
    // stale second HQ request cannot use a previously absent-line quote.
    try{await context.adapter.recheckMaterial(job.id,material,await this.store.materialIds(context.scope,job.id,sku));}
    catch(error){await this.store.cancelUndispatched(context.scope,idempotencyKey);
      if(this.inventory.releaseUndispatched)await this.inventory.releaseUndispatched({accountId:principal.accountId,operationId:JSON.stringify([context.scope,idempotencyKey])});
      throw error;}
    let result;
    try {
      requireValue(await this.authorizeAction(principal, 'materials:create'), 'FORBIDDEN', 403);
      await this.store.dispatching(context.scope, idempotencyKey);
      const item = material.update?await context.adapter.updateMaterial(job.id,material,await this.store.materialIds(context.scope,job.id,sku)):await context.adapter.postMaterial(job.id, material);
      requireValue(typeof item?.id === 'string' && item.id.length > 0 && item.quantity === (material.update?.newQuantity ?? count) &&
        item.unitPriceCents === material.unitPriceCents && item.unitCostCents === material.unitCostCents &&
        item.taxable === material.taxable, 'SUBMISSION_UNKNOWN', 409);
      result = { status: 'verification_pending', jobId: job.id, jobNumber: c.job_number, material: item,
        operation:material.update?'update':'create',additionalQuantity:count };
      await this.store.remoteCreated(context.scope, idempotencyKey, result);
    } catch(error) {
      if(material.update && ['MATERIAL_UPDATE_NOT_AUTHORIZED','MATERIAL_UPDATE_UNAVAILABLE','MATERIAL_UPDATE_REJECTED','EXISTING_MATERIAL_CHANGED','PART_IDENTITY_UNVERIFIED','MULTIPLE_MATERIAL_MATCHES'].includes(error?.code)){
        await this.store.rejectUpdate(context.scope,idempotencyKey,error.code);
        if(this.inventory.releaseUndispatched)await this.inventory.releaseUndispatched({accountId:principal.accountId,operationId:JSON.stringify([context.scope,idempotencyKey])});
        throw error;
      }
      await this.store.unknown(context.scope, idempotencyKey);
      throw new IntegrationError('SUBMISSION_UNKNOWN', 409);
    }
    return this.verifyAndFinish(principal, context, idempotencyKey, result, reservationId, material);
  }
  async verifyAndFinish(principal, context, key, result, reservationId, material) {
    try {
      const verified = await context.adapter.verifyMaterial(result.jobId, result.material.id, material);
      requireValue(verified?.id === result.material.id, 'MATERIAL_VERIFICATION_FAILED', 409);
      result = { ...result, material: verified, status: 'inventory_pending' };
      await this.store.materialCreated(context.scope, key, result);
    } catch { return { ...result, status: 'verification_pending' }; }
    return this.finishInventory(principal, context, key, result, reservationId);
  }
  async recoverInventory(principal, input) {
    requireValue(input && Object.keys(input).length === 1 && typeof input.idempotencyKey === 'string');
    const context = await this.context(principal, 'materials:recover');
    const old = await this.store.get(context.scope, input.idempotencyKey);
    requireValue(old && old.owner_id === principal.id, 'FORBIDDEN', 403);
    if (old.state === 'confirmed') return JSON.parse(old.result);
    if (old.state === 'verification_pending' && old.result && old.reservation_id && old.payload)
      return this.verifyAndFinish(principal, context, input.idempotencyKey, JSON.parse(old.result), old.reservation_id, JSON.parse(old.payload));
    requireValue(old.state === 'inventory_pending' && old.result && old.reservation_id, 'MANUAL_RECONCILIATION_REQUIRED', 409);
    // Recovery ONLY commits inventory using the recorded remote ID; never repeats a material POST.
    return this.finishInventory(principal, context, input.idempotencyKey, JSON.parse(old.result), old.reservation_id);
  }
  async submissionStatus(principal, input) {
    requireValue(input && Object.keys(input).length === 1 && typeof input.idempotencyKey === 'string');
    const context = await this.context(principal, 'materials:read');
    const row = await this.store.get(context.scope, input.idempotencyKey);
    requireValue(row && row.owner_id === principal.id, 'FORBIDDEN', 403);
    if (['confirmed', 'inventory_pending', 'verification_pending'].includes(row.state)) return JSON.parse(row.result);
    if (row.state === 'failed') return { status: 'failed' };
    return { status: row.state === 'unknown' ? 'reconciliation_required' : 'submission_pending' };
  }
}

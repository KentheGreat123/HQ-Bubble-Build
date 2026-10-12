import { requireValue } from './errors.mjs';

const stable = value => JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])):value);
const unchanged = item => Object.fromEntries(Object.entries(item).filter(([key])=>!['quantity','amount'].includes(key)));

/** HcpClient and its server-only credential/transport gates remain unchanged. */
export class HousecallProJobMaterialsAdapter {
  constructor({ client, externalAccountId }) {
    requireValue(client && typeof externalAccountId === 'string' && externalAccountId.length > 0);
    Object.assign(this, { client, externalAccountId });
  }
  job(raw) {
    requireValue(raw?.company_id === this.externalAccountId, 'FORBIDDEN', 403);
    requireValue(typeof raw.id === 'string' && raw.id.length > 0 && typeof raw.invoice_number === 'string',
      'HCP_INVALID_RESPONSE', 502);
    return { id: raw.id, jobNumber: raw.invoice_number,
      customerName: [raw.customer?.first_name, raw.customer?.last_name].filter(Boolean).join(' '),
      street: raw.address?.street ?? '', description: raw.description ?? '',
      available: !raw.locked_at && !raw.deleted_at && !raw.canceled_at };
  }
  async findJobsByNumber(number) {
    requireValue(/^\d{1,32}$/.test(number));
    return (await this.client.findJobsByNumber(number)).map(raw => this.job(raw));
  }
  async getJob(id) { return this.job(await this.client.getJob(id)); }
  async inspectMaterial(jobId,material,knownIds=[]) {
    await this.getJob(jobId);
    const lines=await this.client.getMaterials(jobId),ref=material.platformReference;
    const linked=line=>knownIds.some(link=>typeof link==='string'?link===line.id:link.id===line.id&&link.sku===material.sku);
    const identified=line=>knownIds.some(link=>typeof link==='string'?link===line.id:link.id===line.id) ||
      (ref && typeof line.service_item_id==='string'&&typeof line.service_item_type==='string');
    // A legacy material with no trustworthy identifier cannot prove absence or
    // uniqueness. Block instead of guessing from description/name similarity.
    requireValue(!lines.some(line=>line.kind==='materials'&&!identified(line)),'PART_IDENTITY_UNVERIFIED',409);
    const matches=lines.filter(line=>line.kind==='materials' && (linked(line) ||
      (ref && line.service_item_id===ref.id && line.service_item_type===ref.type)));
    requireValue(matches.length<=1,'MULTIPLE_MATERIAL_MATCHES',409);
    if(!matches.length) {
      return null;
    }
    const item=matches[0];
    requireValue(typeof item.id==='string'&&item.id && typeof item.name==='string'&&item.name &&
      Number.isFinite(item.quantity)&&item.quantity>=0&&Number.isSafeInteger(Math.round(item.quantity*100)) &&
      Number.isSafeInteger(item.unit_price)&&Number.isSafeInteger(item.unit_cost)&&typeof item.taxable==='boolean', 'MATERIAL_UPDATE_UNAVAILABLE',409);
    const totalCents=Math.round(item.quantity*100)+Math.round(material.quantity*100);
    requireValue(Number.isSafeInteger(totalCents),'INVALID_REQUEST');
    return {...this.normalized(item),snapshot:structuredClone(item),newQuantity:totalCents/100};
  }
  async recheckMaterial(jobId,material,knownIds) {
    const match=await this.inspectMaterial(jobId,material,knownIds);
    if(material.update) requireValue(match && match.id===material.update.materialId &&
      stable(match.snapshot)===stable(material.update.snapshot),'EXISTING_MATERIAL_CHANGED',409);
    else requireValue(!match,'PART_ALREADY_ON_JOB',409);
  }
  async updateMaterial(jobId,material,knownIds=[]) {
    requireValue(material.update,'MATERIAL_UPDATE_UNAVAILABLE',409);
    // Last read happens immediately before PUT, after the SQL dispatch claim.
    await this.recheckMaterial(jobId,material,[...knownIds,{id:material.update.materialId,sku:material.sku}]);
    const body={};
    for(const key of ['name','description','unit_price','unit_cost','kind','taxable','service_item_id','service_item_type'])
      if(Object.hasOwn(material.update.snapshot,key))body[key]=material.update.snapshot[key];
    body.quantity=material.update.newQuantity;
    const response=await this.client.updateMaterial(jobId,material.update.materialId,body);
    requireValue(response.status!==401&&response.status!==403,'MATERIAL_UPDATE_NOT_AUTHORIZED',403);
    requireValue(response.status!==404,'MATERIAL_UPDATE_UNAVAILABLE',409);
    requireValue(response.status!==400,'MATERIAL_UPDATE_REJECTED',409);
    requireValue(response.status===200 && response.body?.id===material.update.materialId &&
      response.body.quantity===material.update.newQuantity,'SUBMISSION_UNKNOWN',409);
    return this.normalized(response.body);
  }
  normalized(item) {
    return { id: item.id, name: item.name, description: item.description ?? null, kind: item.kind, quantity: item.quantity,
      unitPriceCents: item.unit_price, unitCostCents: item.unit_cost, taxable: item.taxable,
      ...(Number.isFinite(item.amount) ? { amount: item.amount } : {}) };
  }
  async verifyMaterial(jobId, materialId, expected) {
    await this.getJob(jobId);
    const matches = (await this.client.getMaterials(jobId)).filter(x => x.id === materialId);
    requireValue(matches.length === 1, 'MATERIAL_VERIFICATION_FAILED', 409);
    const item = matches[0];
    const expectedQuantity=expected.update?.newQuantity ?? expected.quantity;
    requireValue(item.name === expected.name && (item.description ?? null) === expected.description && item.kind === 'materials' &&
      item.quantity === expectedQuantity && item.unit_price === expected.unitPriceCents &&
      item.unit_cost === expected.unitCostCents && item.taxable === expected.taxable &&
      (!expected.platformReference || (item.service_item_id === expected.platformReference.id &&
        item.service_item_type === expected.platformReference.type)), 'MATERIAL_VERIFICATION_FAILED', 409);
    if(expected.update)requireValue(stable(unchanged(item))===stable(unchanged(expected.update.snapshot)), 'MATERIAL_VERIFICATION_FAILED',409);
    return this.normalized(item);
  }
  async postMaterial(id, material) {
    const body = { name: material.name, description: material.description, kind: 'materials',
      quantity: material.quantity, unit_price: material.unitPriceCents,
      unit_cost: material.unitCostCents, taxable: material.taxable };
    const reference = material.platformReference;
    if (reference) {
      requireValue(typeof reference.id === 'string' && reference.id.length > 0 &&
        ['market_place', 'organizational', 'pricebook_material'].includes(reference.type), 'CATALOG_INVALID', 503);
      body.service_item_id = reference.id; body.service_item_type = reference.type;
    }
    const response = await this.client.addMaterial(id, body), item = response.body;
    requireValue(response.status === 201 && typeof item?.id === 'string' && item.id.length > 0 &&
      item.kind === 'materials' && item.quantity === material.quantity &&
      item.unit_price === material.unitPriceCents && item.unit_cost === material.unitCostCents &&
      item.taxable === material.taxable, 'SUBMISSION_UNKNOWN', 409);
    return this.normalized(item);
  }
}

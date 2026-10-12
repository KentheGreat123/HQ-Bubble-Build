/** Platform-independent extension contract; this file documents the server ports.
 * Implementations run on the backend only. No ServiceTitan implementation is provided.
 */
export interface AccountConnection {
  accountId: string;
  id: string; // server secret-manager binding identifier; never a credential
  platform: string;
  externalAccountId: string;
  version: number;
}
export interface JobSelection {
  id: string; // opaque platform ID, never interchangeable with a displayed number
  jobNumber: string;
  customerName?: string;
  street?: string;
  description?: string;
  available: boolean;
}
export interface MaterialRequest {
  sku: string;
  name: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  taxable: boolean;
  platformReference?: unknown; // authoritative catalog/adapter-owned metadata
  update?: {materialId:string;existingQuantity:number;newQuantity:number;snapshot:Record<string,unknown>};
}
export interface MaterialResult {
  id: string;
  name?: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  taxable: boolean;
  amount?: number; // optional platform-calculated amount; not a shared invoice total
}
export interface JobMaterialsAdapter {
  // Instance must be bound to ONE verified external account and server credential provider.
  findJobsByNumber(number: string): Promise<JobSelection[]>;
  getJob(id: string): Promise<JobSelection>;
  // Creates a priced, billable job material, not a cost-input-only record.
  // Must validate the upstream response and never automatically retry an uncertain POST.
  postMaterial(id: string, material: MaterialRequest): Promise<MaterialResult>;
  verifyMaterial(jobId: string, materialId: string, expected: MaterialRequest): Promise<MaterialResult>;
  inspectMaterial(jobId:string,material:MaterialRequest,knownIds:({id:string;sku:string}|string)[]):Promise<(MaterialResult & {snapshot:Record<string,unknown>;newQuantity:number}) | null>;
  recheckMaterial(jobId:string,material:MaterialRequest,knownIds:({id:string;sku:string}|string)[]):Promise<void>;
  updateMaterial(jobId:string,material:MaterialRequest):Promise<MaterialResult>;
}
export interface InventoryCoordinator {
  // All operations MUST be durable, account-bound and idempotent by operationId.
  // reserve resolves only after stock is held; insufficient stock must not oversell.
  reserve(input: {accountId: string; operationId: string; sku: string; quantity: number}): Promise<string>;
  commit(input: {accountId: string; operationId: string; reservationId: string; materialId: string}): Promise<void>;
  // A separately authorized reconciliation process must release reservations only
  // after proving no remote material exists. That process is not implemented here.
}

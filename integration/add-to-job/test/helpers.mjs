import { SqliteSubmissionStore } from '../src/submission-store.mjs';
import { MaterialService } from '../src/material-service.mjs';
import { HcpClient } from '../src/hcp-client.mjs';
import { JobMaterialsRegistry } from '../src/job-materials.mjs';
import { HousecallProJobMaterialsAdapter } from '../src/hcp-adapter.mjs';

export const principal = { id: 'tech-test', accountId: 'hq-test', companyId: 'company-test' };
export const job = { id: 'job_test', invoice_number: '4187', company_id: 'company-test',
  customer: { first_name: 'Test', last_name: 'Customer' }, address: { street: 'Test address' } };
export const part = { accountId: principal.accountId, sku: 'TEST-PART', name: 'Test pump',
  unitPriceCents: 4610, unitCostCents: 2300, taxable: true };
export function setup(t, override = {}) {
  const calls = [], store = override.store ?? new SqliteSubmissionStore(':memory:');
  if (!override.store) t.after(() => store.close());
  if (!store.connection(principal.accountId)) store.connect({ accountId: principal.accountId,
    id: 'connection-test', platform: 'housecallpro', externalAccountId: principal.companyId });
  const originalTransport = override.transport ?? (async request => {
    calls.push(request);
    if (request.path.startsWith('/jobs?')) return { status: 200, body: {
      page: 1, page_size: 100, total_pages: 1, total_items: 1, jobs: [job] } };
    if (request.method === 'GET') return { status: 200, body: job };
    return { status: 201, body: { id: 'line_test', ...request.body, amount: 4610 } };
  });
  const created = [];
  const transport = async request => {
    if (request.method === 'GET' && request.path.endsWith('/line_items')) {
      calls.push(request);
      return override.readback && created.length ? override.readback(request, created) : { status: 200, body: {data:created} };
    }
    const result = await originalTransport(request);
    if (request.method === 'POST' && result.status === 201) created.push(result.body);
    return result;
  };
  const client = new HcpClient({ transport });
  const registry = override.registry ?? new JobMaterialsRegistry({ housecallpro: connection =>
    new HousecallProJobMaterialsAdapter({ client, externalAccountId: connection.externalAccountId }) });
  const inventoryCalls = [];
  const inventory = override.inventory ?? {
    reserve: async input => { inventoryCalls.push({ action: 'reserve', ...input }); return 'reservation-test'; },
    commit: async input => { inventoryCalls.push({ action: 'commit', ...input }); }
  };
  const service = new MaterialService({ registry, store, inventory,
    authorizeAction: override.authorizeAction ?? (async () => true),
    authorizeJob: override.authorizeJob ?? (async () => true),
    getPart: override.getPart ?? (async sku => sku === part.sku ? part : null),
    ...(override.now ? { now: override.now } : {}) });
  return { service, calls, store, inventoryCalls };
}
export async function command(service, extra = {}) {
  const confirmation = await service.resolveJob(principal, '4187');
  const selection = { confirmationId: confirmation.confirmationId, sku: part.sku, quantity: '1' };
  // Invalid submission quantities are tested at submit; don't let prepare consume the assertion.
  if (['1.25', '2'].includes(extra.quantity)) selection.quantity = extra.quantity;
  const quote = await service.prepareMaterial(principal, selection);
  return { ...selection, quoteId: quote.quoteId, idempotencyKey: 'test-request-0001', ...extra };
}

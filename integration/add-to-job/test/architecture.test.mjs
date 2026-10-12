import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { JobMaterialsRegistry } from '../src/job-materials.mjs';
import { SqliteSubmissionStore } from '../src/submission-store.mjs';
import { createHandler } from '../src/http-handler.mjs';
import { principal, job, part, setup, command } from './helpers.mjs';

const replacement = { accountId: principal.accountId, id: 'connection-next',
  platform: 'future-mock', externalAccountId: 'mock-external' };

test('shared workflow runs against a vendor-neutral fake adapter without HCP fields', async t => {
  const posts = [], normalized = { id: 'opaque/job-A', jobNumber: '4187', available: true };
  const registry = new JobMaterialsRegistry({ housecallpro: () => ({
    findJobsByNumber: async () => [normalized], getJob: async () => normalized,
    postMaterial: async (id, material) => { posts.push({ id, material }); return { id: 'mock-line', ...material }; },
    verifyMaterial: async (id, lineId, material) => ({id:lineId,...material}),inspectMaterial:async()=>null,
    recheckMaterial:async()=>{},updateMaterial:async()=>{throw new Error('No update fixture');}
  }) });
  const { service } = setup(t, { registry });
  const result = await service.addMaterial(principal, await command(service));
  assert.equal(result.status, 'confirmed'); assert.equal(result.material.id, 'mock-line');
  assert.equal(posts[0].id, normalized.id); assert.equal(posts[0].material.unitPriceCents, 4610);
  const source = readFileSync(new URL('../src/material-service.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /HcpClient|invoice_number|unit_price|company_id|\/line_items|housecallpro/i);
});

test('one account has exactly one persisted connection; ServiceTitan is not implemented', async t => {
  const { service, store } = setup(t);
  store.connect({ ...replacement, platform: 'servicetitan' });
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM account_connections WHERE account_id = ?').get(principal.accountId).n, 1);
  assert.equal(store.connection(principal.accountId).platform, 'servicetitan');
  await assert.rejects(service.resolveJob(principal, '4187'), e => e.code === 'PLATFORM_NOT_IMPLEMENTED');
});

test('connection replacement invalidates outstanding confirmations even if platform stays HCP', async t => {
  const { service, store, calls } = setup(t), input = await command(service);
  store.connect({ ...replacement, platform: 'housecallpro', externalAccountId: principal.companyId });
  await assert.rejects(service.addMaterial(principal, input), e => e.code === 'INVALID_CONFIRMATION');
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('missing account membership/write permission fails before adapter or inventory', async t => {
  const denied = setup(t, { authorizeAction: async (p, action) => p.accountId === principal.accountId && action === 'jobs:read' });
  const c = await denied.service.resolveJob(principal, '4187');
  await assert.rejects(denied.service.prepareMaterial(principal, { confirmationId: c.confirmationId, sku: part.sku, quantity: 1 }),
    e => e.code === 'FORBIDDEN');
  await assert.rejects(denied.service.resolveJob({ ...principal, accountId: 'victim' }, '4187'), e => e.code === 'FORBIDDEN');
  assert.equal(denied.inventoryCalls.length, 0);
});

test('foreign HCP company is rejected by adapter and foreign catalog data by workflow', async t => {
  const foreignJob = setup(t, { transport: async () => ({ status: 200,
    body: { page: 1, total_pages: 1, jobs: [{ ...job, company_id: 'victim' }] } }) });
  await assert.rejects(foreignJob.service.resolveJob(principal, '4187'), e => e.code === 'FORBIDDEN');
  const foreignPart = setup(t, { getPart: async () => ({ ...part, accountId: 'victim' }) });
  await assert.rejects(command(foreignPart.service), e => e.code === 'PART_UNAVAILABLE');
});

test('price confirmation exposes price but not internal cost; changed price needs new confirmation', async t => {
  let price = 4610;
  const { service, calls } = setup(t, { getPart: async () => ({ ...part, unitPriceCents: price }) });
  const c = await service.resolveJob(principal, '4187'), selection = { confirmationId: c.confirmationId, sku: part.sku, quantity: 1 };
  const quote = await service.prepareMaterial(principal, selection);
  assert.equal(quote.unitPriceCents, 4610); assert.equal(Object.hasOwn(quote, 'unitCostCents'), false);
  price++;
  await assert.rejects(service.addMaterial(principal, { ...selection, quoteId: quote.quoteId, idempotencyKey: 'price-test-0001' }),
    e => e.code === 'PRICE_OR_SELECTION_CHANGED');
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('quote expires independently of job confirmation and binds quantity/part', async t => {
  let now = 1000;
  const { service } = setup(t, { now: () => now }), input = await command(service);
  await assert.rejects(service.addMaterial(principal, { ...input, quantity: 2 }), e => e.code === 'PRICE_OR_SELECTION_CHANGED');
  now += 5 * 60 * 1000;
  await assert.rejects(service.addMaterial(principal, input), e => e.code === 'INVALID_QUOTE');
});

test('account-wide idempotency keys cannot be reused by another technician', async t => {
  const { service, calls } = setup(t), input = await command(service);
  await service.addMaterial(principal, input);
  await assert.rejects(service.addMaterial({ ...principal, id: 'another-tech' }, input), e => e.code === 'FORBIDDEN');
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});

test('uncertain inventory reservation prevents POST and prevents automatic reserve retry', async t => {
  let reserves = 0;
  const { service, calls, store } = setup(t, { inventory: {
    reserve: async () => { reserves++; throw new Error('mock timeout after reservation'); }, commit: async () => assert.fail()
  } });
  const input = await command(service);
  await assert.rejects(service.addMaterial(principal, input), e => e.code === 'INVENTORY_RESERVATION_UNKNOWN');
  await assert.rejects(service.addMaterial(principal, input), e => e.code === 'SUBMISSION_UNKNOWN');
  assert.equal(reserves, 1); assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  assert.throws(() => store.connect(replacement), e => e.code === 'CONNECTION_HAS_UNRESOLVED_SUBMISSIONS');
});

test('remote success with inventory failure returns pending; recovery never posts material again', async t => {
  let unavailable = true, commits = 0;
  const { service, calls, store } = setup(t, { inventory: {
    reserve: async () => 'held-stock', commit: async () => { commits++; if (unavailable) throw new Error('mock inventory unavailable'); }
  } });
  const input = await command(service), result = await service.addMaterial(principal, input);
  assert.equal(result.status, 'inventory_pending'); assert.equal(result.material.id, 'line_test');
  assert.equal((await service.addMaterial(principal, input)).status, 'inventory_pending');
  assert.equal(commits, 1);
  assert.throws(() => store.connect(replacement), e => e.code === 'CONNECTION_HAS_UNRESOLVED_SUBMISSIONS');
  unavailable = false;
  assert.equal((await service.recoverInventory(principal, { idempotencyKey: input.idempotencyKey })).status, 'confirmed');
  await service.recoverInventory(principal, { idempotencyKey: input.idempotencyKey });
  assert.equal(commits, 2); assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  store.connect(replacement); // completed operations do not block replacement
});

test('inventory recovery is permission-gated and unknown remote results require manual reconciliation', async t => {
  const { service } = setup(t, { authorizeAction: async (p, action) => action !== 'materials:recover' });
  await assert.rejects(service.recoverInventory(principal, { idempotencyKey: 'test-request-0001' }), e => e.code === 'FORBIDDEN');
  const uncertain = setup(t, { transport: async request => {
    if (request.path.startsWith('/jobs?')) return { status: 200, body: { page: 1, total_pages: 1, jobs: [job] } };
    if (request.method === 'GET') return { status: 200, body: job };
    throw new Error('mock write timeout');
  } });
  const input = await command(uncertain.service);
  await assert.rejects(uncertain.service.addMaterial(principal, input));
  await assert.rejects(uncertain.service.recoverInventory(principal, { idempotencyKey: input.idempotencyKey }),
    e => e.code === 'MANUAL_RECONCILIATION_REQUIRED');
  assert.equal(uncertain.inventoryCalls.filter(c => c.action === 'commit').length, 0);
});

test('pending material result survives restart and only inventory is retried', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-architecture-mock-'));
  let store;
  try {
    const path = join(dir, 'mock.sqlite'); store = new SqliteSubmissionStore(path);
    const first = setup(t, { store, inventory: { reserve: async () => 'held', commit: async () => { throw new Error('mock'); } } });
    const input = await command(first.service); await first.service.addMaterial(principal, input);
    store.close(); store = new SqliteSubmissionStore(path);
    const restarted = setup(t, { store });
    const result = await restarted.service.recoverInventory(principal, { idempotencyKey: input.idempotencyKey });
    assert.equal(result.status, 'confirmed'); assert.equal(result.material.id, 'line_test');
    assert.equal(restarted.calls.length, 0); assert.equal(restarted.inventoryCalls[0].reservationId, 'held');
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('connection replacement during catalog await cannot write with the old connection', async t => {
  let swap = false, store;
  const fixture = setup(t, { getPart: async () => {
    if (swap) store.connect({ ...replacement, platform: 'housecallpro', externalAccountId: principal.companyId });
    return part;
  } });
  store = fixture.store;
  const input = await command(fixture.service); swap = true;
  await assert.rejects(fixture.service.addMaterial(principal, input), e => e.code === 'CONNECTION_CHANGED');
  assert.equal(fixture.calls.filter(c => c.method === 'POST').length, 0);
});

test('HTTP returns 202 for partial completion; client cannot pick platform or job ID', async t => {
  const { service } = setup(t, { inventory: { reserve: async () => 'held', commit: async () => { throw new Error('mock'); } } });
  const input = await command(service), handler = createHandler({ service, authenticate: async () => principal });
  const post = body => handler(new Request('https://backend.test/api/hq/materials', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const blocked = await post({ ...input, platform: 'servicetitan', jobId: 'victim' });
  assert.equal(blocked.status, 400);
  const pending = await post(input); assert.equal(pending.status, 202);
  assert.equal((await pending.json()).status, 'inventory_pending');
});

test('submission status reads durable state without network and denies another account/user', async t => {
  const { service, calls } = setup(t), input = await command(service);
  await service.addMaterial(principal, input);
  const before = calls.length;
  assert.equal((await service.submissionStatus(principal, { idempotencyKey: input.idempotencyKey })).status, 'confirmed');
  assert.equal(calls.length, before);
  await assert.rejects(service.submissionStatus({ ...principal, id: 'other' }, { idempotencyKey: input.idempotencyKey }),
    e => e.code === 'FORBIDDEN');
  await assert.rejects(service.submissionStatus({ ...principal, accountId: 'victim' }, { idempotencyKey: input.idempotencyKey }),
    e => e.code === 'PLATFORM_NOT_CONNECTED');
});

test('catalog platform reference stays adapter-owned and maps to official HCP fields', async t => {
  const { service, calls } = setup(t, { getPart: async () => ({ ...part,
    platformReference: { id: 'pricebook-test', type: 'pricebook_material' } }) });
  await service.addMaterial(principal, await command(service));
  const body = calls.find(c => c.method === 'POST').body;
  assert.equal(body.service_item_id, 'pricebook-test'); assert.equal(body.service_item_type, 'pricebook_material');
});

test('write permission revoked while reserving inventory prevents the material POST', async t => {
  let allowed = true;
  const { service, calls } = setup(t, { authorizeAction: async () => allowed,
    inventory: { reserve: async () => { allowed = false; return 'held'; }, commit: async () => assert.fail() } });
  const input = await command(service);
  await assert.rejects(service.addMaterial(principal, input), e => e.code === 'SUBMISSION_UNKNOWN');
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('legacy submissions migrate additively and block unsafe connection provisioning', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-migration-mock-')), path = join(dir, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE submissions (scope TEXT NOT NULL, request_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL, state TEXT NOT NULL, result TEXT, job_id TEXT, payload TEXT,
    created_at INTEGER, PRIMARY KEY(scope, request_key));
    INSERT INTO submissions VALUES ('legacy-scope', 'legacy-key', 'fingerprint', 'pending',
    NULL, 'legacy-job', '{"name":"legacy"}', 0);`);
  legacy.close();
  const store = new SqliteSubmissionStore(path);
  try {
    assert.throws(() => store.connect(replacement), e => e.code === 'CONNECTION_HAS_UNRESOLVED_SUBMISSIONS');
    assert.equal(store.get('legacy-scope', 'legacy-key').job_id, 'legacy-job');
    store.complete('legacy-scope', 'legacy-key', { status: 'confirmed', material: { id: 'legacy-material' } });
    store.connect(replacement); assert.equal(store.connection(principal.accountId).id, replacement.id);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MaterialService } from '../src/material-service.mjs';
import { SqliteSubmissionStore } from '../src/submission-store.mjs';
import { HcpClient, createLiveTransport } from '../src/hcp-client.mjs';
import { createHandler } from '../src/http-handler.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { principal, job, part, setup, command } from './helpers.mjs';

test('resolve a displayed job number to its HCP ID and return a confirmation', async t => {
  const { service, calls } = setup(t);
  const result = await service.resolveJob(principal, '4187');
  assert.equal(result.job.id, 'job_test');
  assert.equal(result.job.jobNumber, '4187');
  assert.ok(result.confirmationId);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].path, '/jobs?page=1&page_size=100');
});
test('create exactly one material with server catalog prices in cents', async t => {
  const { service, calls } = setup(t);
  const input = await command(service);
  const first = await service.addMaterial(principal, input);
  const replay = await service.addMaterial(principal, input);
  assert.equal(first.material.id, 'line_test');
  assert.deepEqual(replay, first);
  const writes = calls.filter(c => c.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/jobs/job_test/line_items');
  assert.deepEqual(writes[0].body, { name: 'Test pump', description: 'Part # TEST-PART',
    kind: 'materials', quantity: 1, unit_price: 4610, unit_cost: 2300, taxable: true });
});
test('paginate all jobs rather than mistake page one for the only match', async t => {
  const { service } = setup(t, { transport: async request => ({ status: 200, body: {
    page: request.path.includes('page=1&') ? 1 : 2, total_pages: 2,
    jobs: request.path.includes('page=1&') ? [] : [job] } }) });
  assert.equal((await service.resolveJob(principal, '4187')).job.id, job.id);
});
test('no match and ambiguous numbers produce no write', async t => {
  for (const jobs of [[], [job, { ...job, id: 'job_other' }]]) {
    const { service } = setup(t, { transport: async () => ({ status: 200,
      body: { page: 1, total_pages: 1, jobs } }) });
    await assert.rejects(service.resolveJob(principal, '4187'),
      error => error.code === (jobs.length ? 'AMBIGUOUS_JOB' : 'JOB_NOT_FOUND'));
  }
});
test('authorization and company isolation happen before write', async t => {
  const { service, calls } = setup(t, { authorizeJob: async () => false });
  await assert.rejects(service.resolveJob(principal, '4187'), e => e.code === 'FORBIDDEN');
  await assert.rejects(service.resolveJob({ ...principal, accountId: 'another' }, '4187'),
    e => e.code === 'PLATFORM_NOT_CONNECTED');
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});
test('client cannot override catalog price/type or add unexpected fields', async t => {
  const { service, calls } = setup(t);
  const input = await command(service, { unit_price: 1, kind: 'labor' });
  await assert.rejects(service.addMaterial(principal, input), e => e.code === 'INVALID_REQUEST');
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});
test('quantity must be positive with at most two decimal places', async t => {
  const { service, calls } = setup(t);
  for (const quantity of ['0', '-1', '1.001', 'NaN']) {
    const input = await command(service, { quantity });
    await assert.rejects(service.addMaterial(principal, input), e => e.code === 'INVALID_REQUEST');
  }
  const result = await service.addMaterial(principal, await command(service, { quantity: '1.25' }));
  assert.equal(result.material.quantity, 1.25);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});
test('another technician cannot reuse the job confirmation', async t => {
  const { service } = setup(t);
  const input = await command(service);
  await assert.rejects(service.addMaterial({ ...principal, id: 'other-tech' }, input),
    e => e.code === 'INVALID_CONFIRMATION');
});
test('idempotency key reuse with changed quantity is rejected', async t => {
  const { service } = setup(t);
  const input = await command(service);
  await service.addMaterial(principal, input);
  await assert.rejects(service.addMaterial(principal, { ...input, quantity: '2' }),
    e => e.code === 'IDEMPOTENCY_CONFLICT');
});
test('uncertain timeout cannot trigger an automatic second material write', async t => {
  let writes = 0;
  const { service } = setup(t, { transport: async request => {
    if (request.path.startsWith('/jobs?')) return { status: 200, body: { page: 1, total_pages: 1, jobs: [job] } };
    if (request.method === 'GET') return { status: 200, body: job };
    writes++; throw new Error('mock timeout');
  } });
  const input = await command(service);
  await assert.rejects(service.addMaterial(principal, input), e => e.code === 'SUBMISSION_UNKNOWN');
  await assert.rejects(service.addMaterial(principal, input), e => e.code === 'SUBMISSION_UNKNOWN');
  assert.equal(writes, 1);
});
test('201 without a valid material response is not displayed as success', async t => {
  const { service } = setup(t, { transport: async request => {
    if (request.path.startsWith('/jobs?')) return { status: 200, body: { page: 1, total_pages: 1, jobs: [job] } };
    return request.method === 'GET' ? { status: 200, body: job } : { status: 201, body: {} };
  } });
  await assert.rejects(service.addMaterial(principal, await command(service)), e => e.code === 'SUBMISSION_UNKNOWN');
});
test('auth/validation/rate-limit/server failures never become success or retries', async t => {
  for (const status of [400, 401, 403, 404, 422, 429, 500]) {
    const { service } = setup(t, { transport: async request => {
      if (request.path.startsWith('/jobs?')) return { status: 200, body: { page: 1, total_pages: 1, jobs: [job] } };
      return request.method === 'GET' ? { status: 200, body: job } : { status, body: { error: 'mock' } };
    } });
    await assert.rejects(service.addMaterial(principal, await command(service)), e => e.code === 'SUBMISSION_UNKNOWN');
  }
});
test('HTTP interface denies unauthenticated requests and exposes no secrets', async t => {
  const { service } = setup(t);
  const handler = createHandler({ service, authenticate: async () => null });
  const response = await handler(new Request('https://backend.test/api/hq/jobs/resolve', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobNumber: '4187' }) }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'UNAUTHENTICATED' });
});
test('live network is disabled even if a server secret provider is supplied', async () => {
  let fetched = false;
  const transport = createLiveTransport({ getApiKey: async () => 'mock-only-not-a-real-key',
    fetchImpl: async () => { fetched = true; throw new Error('unexpected network'); } });
  await assert.rejects(transport({ method: 'POST', path: '/jobs/job_test/line_items', body: {} }),
    e => e.code === 'LIVE_REQUESTS_DISABLED');
  assert.equal(fetched, false);
});
test('durable submission claims and confirmed results survive restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hq-material-mock-'));
  let store;
  try {
    const path = join(directory, 'mock.sqlite'); store = new SqliteSubmissionStore(path);
    assert.equal(store.claim('scope', 'request-one', 'fingerprint'), true);
    assert.equal(store.claim('scope', 'request-two', 'fingerprint-two'), true);
    store.complete('scope', 'request-two', { status: 'confirmed', material: { id: 'line_test' } });
    store.close(); store = new SqliteSubmissionStore(path);
    assert.equal(store.claim('scope', 'request-one', 'fingerprint'), false);
    assert.equal(store.get('scope', 'request-one').state, 'pending');
    assert.equal(JSON.parse(store.get('scope', 'request-two').result).material.id, 'line_test');
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('concurrent duplicate submissions make only one POST', async t => {
  let writes = 0, release, signalDispatch;
  const paused = new Promise(resolve => { release = resolve; });
  const dispatched = new Promise(resolve => { signalDispatch = resolve; });
  const { service } = setup(t, { transport: async request => {
    if (request.path.startsWith('/jobs?')) return { status: 200, body: { page: 1, total_pages: 1, jobs: [job] } };
    if (request.method === 'GET') return { status: 200, body: job };
    writes++; signalDispatch(); await paused; return { status: 201, body: { id: 'line_test', ...request.body } };
  } });
  const input = await command(service), first = service.addMaterial(principal, input);
  await dispatched;
  await assert.rejects(service.addMaterial(principal, input), e => e.code === 'SUBMISSION_UNKNOWN');
  release(); await first; assert.equal(writes, 1);
});
test('single-line update transport uses documented PUT and remains gated to the approved job',async()=>{
 const seen=[],transport=createLiveTransport({enableLiveRequests:true,enableLiveWrites:true,approvedTestJobIds:['job_test'],getApiKey:async()=> 'fake-key-only',
  fetchImpl:async(url,options)=>{seen.push({url:String(url),options});return{ok:true,status:200,json:async()=>({id:'line_test',quantity:3})};}});
 const response=await transport({method:'PUT',path:'/jobs/job_test/line_items/line_test',body:{name:'Test pump',quantity:3}});
 assert.equal(response.status,200);assert.equal(seen[0].options.method,'PUT');assert.equal(seen[0].url,'https://api.housecallpro.com/jobs/job_test/line_items/line_test');
 await assert.rejects(transport({method:'PUT',path:'/jobs/foreign_job/line_items/line_test',body:{name:'Test pump',quantity:3}}),e=>e.code==='LIVE_WRITES_DISABLED');
 await assert.rejects(transport({method:'PATCH',path:'/jobs/job_test/line_items/line_test',body:{quantity:3}}),e=>e.code==='HCP_OPERATION_NOT_ALLOWED');
 assert.equal(seen.length,1);
});
test('approved fake transport checks exact auth, origin and path; other jobs remain blocked', async () => {
  const seen = [];
  const transport = createLiveTransport({ enableLiveRequests: true, enableLiveWrites: true,
    approvedTestJobIds: ['job_test'], getApiKey: async () => 'mock-key-not-valid',
    fetchImpl: async (url, options) => { seen.push({ url: String(url), options });
      return new Response(JSON.stringify({ id: 'mock' }), { status: 201 }); } });
  await transport({ method: 'POST', path: '/jobs/job_test/line_items', body: { name: 'Mock part' } });
  assert.equal(seen[0].url, 'https://api.housecallpro.com/jobs/job_test/line_items');
  assert.equal(seen[0].options.headers.Authorization, 'Token mock-key-not-valid');
  assert.equal(seen[0].options.redirect, 'error');
  await assert.rejects(transport({ method: 'POST', path: '/jobs/not_approved/line_items', body: {} }),
    e => e.code === 'LIVE_WRITES_DISABLED');
  await assert.rejects(transport({ method: 'GET', path: '//untrusted.test/jobs' }),
    e => e.code === 'HCP_OPERATION_NOT_ALLOWED');
  assert.equal(seen.length, 1);
});
test('live read permission alone never enables a POST', async () => {
  const transport = createLiveTransport({ enableLiveRequests: true,
    getApiKey: async () => { throw new Error('secret provider should not run'); } });
  await assert.rejects(transport({ method: 'POST', path: '/jobs/job_test/line_items', body: {} }),
    e => e.code === 'LIVE_WRITES_DISABLED');
});
test('job changes after confirmation prevent a material write', async t => {
  const { service } = setup(t, { transport: async request => request.path.startsWith('/jobs?')
    ? { status: 200, body: { page: 1, total_pages: 1, jobs: [job] } }
    : { status: 200, body: { ...job, invoice_number: 'changed' } } });
  await assert.rejects(async () => service.addMaterial(principal, await command(service)), e => e.code === 'JOB_CHANGED');
});
test('locked jobs are rejected during resolution', async t => {
  const { service } = setup(t, { transport: async () => ({ status: 200, body: {
    page: 1, total_pages: 1, jobs: [{ ...job, locked_at: '2026-10-11T00:00:00Z' }] } }) });
  await assert.rejects(service.resolveJob(principal, '4187'), e => e.code === 'JOB_UNAVAILABLE');
});
test('complete HTTP flow uses authenticated principal and sanitized errors', async t => {
  const { service } = setup(t), handler = createHandler({ service, authenticate: async () => principal });
  const post = (path, body) => handler(new Request('https://backend.test' + path, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const resolved = await post('/api/hq/jobs/resolve', { jobNumber: '4187' });
  assert.equal(resolved.status, 200); const confirmation = await resolved.json();
  const selection = { confirmationId: confirmation.confirmationId, sku: part.sku, quantity: '1' };
  const quote = await (await post('/api/hq/materials/prepare', selection)).json();
  const created = await post('/api/hq/materials', { ...selection, quoteId: quote.quoteId, idempotencyKey: 'http-mock-request' });
  assert.equal(created.status, 201); assert.equal((await created.json()).status, 'confirmed');
  const malformed = await post('/api/hq/materials', { sku: part.sku });
  assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: 'INVALID_REQUEST' });
});
test('request body limit is enforced even without Content-Length', async t => {
  const { service } = setup(t), handler = createHandler({ service, authenticate: async () => principal });
  const response = await handler(new Request('https://backend.test/api/hq/jobs/resolve', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(17000) }));
  assert.equal(response.status, 413);
});
test('expired confirmations reject a write', async t => {
  let now = 1000;
  const { service, calls } = setup(t, { now: () => now });
  const input = await command(service); now += 10 * 60 * 1000;
  await assert.rejects(service.addMaterial(principal, input), e => e.code === 'INVALID_CONFIRMATION');
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});
test('unknown submissions retain job and payload for operator reconciliation', async t => {
  const { service, store } = setup(t, { transport: async request => {
    if (request.path.startsWith('/jobs?')) return { status: 200, body: { page: 1, total_pages: 1, jobs: [job] } };
    if (request.method === 'GET') return { status: 200, body: job };
    throw new Error('mock timeout');
  } });
  const input = await command(service);
  await assert.rejects(service.addMaterial(principal, input));
  const saved = store.get(JSON.stringify([principal.accountId, 'connection-test', 1]), input.idempotencyKey);
  assert.equal(saved.state, 'unknown'); assert.equal(saved.job_id, job.id);
  assert.equal(JSON.parse(saved.payload).unitPriceCents, 4610);
  assert.equal(JSON.parse(saved.payload).sku, part.sku);
});
test('adapter fields and kinds agree with the captured official schema', async t => {
  const contract = JSON.parse(readFileSync(new URL('../official-contract.json', import.meta.url), 'utf8'));
  const { service, calls } = setup(t); await service.addMaterial(principal, await command(service));
  const request = calls.find(c => c.method === 'POST');
  assert.equal(contract.method, request.method);
  assert.equal(contract.path, '/jobs/{job_id}/line_items');
  assert.deepEqual(contract.createSchema.required, ['name']);
  for (const field of Object.keys(request.body)) assert.ok(Object.hasOwn(contract.createSchema.properties, field));
  assert.ok(contract.createSchema.properties.kind.enum.includes(request.body.kind));
  assert.match(contract.createSchema.properties.unit_price.description, /cents/);
  assert.match(contract.createSchema.properties.unit_cost.description, /cents/);
  assert.ok(!contract.jobsQuery.includes('invoice_number'));
  assert.deepEqual(contract.documentedResponseCodes, ['201']);
});


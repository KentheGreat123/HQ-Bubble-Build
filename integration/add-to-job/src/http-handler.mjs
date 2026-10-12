import { IntegrationError, requireValue } from './errors.mjs';

/** Framework-neutral, server-only Request/Response handler. Authentication is
 * mandatory and must validate a real server session/JWT, not the web app's local PIN.
 */
export function createHandler({ service, authenticate }) {
  requireValue(service && typeof authenticate === 'function');
  return async request => {
    const json = (body, status) => new Response(JSON.stringify(body), { status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    try {
      const principal = await authenticate(request);
      requireValue(principal, 'UNAUTHENTICATED', 401);
      const path = new URL(request.url).pathname;
      requireValue(request.method === 'POST' && ['/api/hq/jobs/resolve', '/api/hq/materials',
        '/api/hq/materials/prepare', '/api/hq/materials/recover', '/api/hq/materials/status'].includes(path), 'NOT_FOUND', 404);
      requireValue(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'INVALID_REQUEST', 415);
      // Bound the actual stream, not just an untrusted Content-Length header.
      const reader = request.body?.getReader(); requireValue(reader);
      let bytes = 0; const chunks = [];
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 16384) { await reader.cancel(); throw new IntegrationError('REQUEST_TOO_LARGE', 413); }
        chunks.push(value);
      }
      let input; try { const all = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; } input = JSON.parse(new TextDecoder().decode(all)); }
      catch { throw new IntegrationError('INVALID_REQUEST'); }
      if (path === '/api/hq/jobs/resolve') {
        requireValue(input && Object.keys(input).length === 1 && Object.hasOwn(input, 'jobNumber'));
        return json(await service.resolveJob(principal, input.jobNumber), 200);
      }
      if (path === '/api/hq/materials/prepare') return json(await service.prepareMaterial(principal, input), 200);
      if (path === '/api/hq/materials/status') return json(await service.submissionStatus(principal, input), 200);
      const result = path === '/api/hq/materials/recover'
        ? await service.recoverInventory(principal, input) : await service.addMaterial(principal, input);
      return json(result, ['inventory_pending', 'verification_pending'].includes(result.status) ? 202 : path.endsWith('/recover') || result.operation==='update' ? 200 : 201);
    } catch (error) {
      // No upstream bodies, exception text, authorization headers or secrets in responses.
      return json({ error: error instanceof IntegrationError ? error.code : 'INTERNAL_ERROR' },
        error instanceof IntegrationError ? error.status : 500);
    }
  };
}

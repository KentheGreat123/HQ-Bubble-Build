import { IntegrationError, requireValue } from './errors.mjs';

export class HcpClient {
  constructor({ transport, maxPages = 100 }) {
    requireValue(typeof transport === 'function' && Number.isInteger(maxPages) && maxPages > 0);
    this.transport = transport; this.maxPages = maxPages;
  }
  async read(path) {
    const response = await this.transport({ method: 'GET', path });
    requireValue(response.status === 200, 'HCP_READ_FAILED', 502);
    return response.body;
  }
  async findJobsByNumber(number) {
    // The official Get Jobs query has no invoice/job-number filter.
    const matches = new Map();
    for (let page = 1; page <= this.maxPages; page++) {
      const data = await this.read(`/jobs?page=${page}&page_size=100`);
      requireValue(Array.isArray(data.jobs) && data.page === page &&
        Number.isInteger(data.total_pages) && data.total_pages >= 0,
        'HCP_INVALID_RESPONSE', 502);
      for (const job of data.jobs) if (job.invoice_number === number) {
        requireValue(typeof job.id === 'string' && job.id.length > 0, 'HCP_INVALID_RESPONSE', 502);
        matches.set(job.id, job);
      }
      if (page >= data.total_pages) return [...matches.values()];
    }
    throw new IntegrationError('JOB_LOOKUP_INCOMPLETE', 503);
  }
  getJob(id) { return this.read(`/jobs/${encodeURIComponent(id)}`); }
  async getMaterials(id) {
    const body = await this.read(`/jobs/${encodeURIComponent(id)}/line_items`);
    requireValue(Array.isArray(body?.data), 'HCP_INVALID_RESPONSE', 502);
    return body.data;
  }
  addMaterial(id, body) {
    return this.transport({ method: 'POST', path: `/jobs/${encodeURIComponent(id)}/line_items`, body });
  }
  updateMaterial(jobId, materialId, body) {
    return this.transport({method:'PUT',path:`/jobs/${encodeURIComponent(jobId)}/line_items/${encodeURIComponent(materialId)}`,body});
  }
}

/** Server-only adapter. Both network and writes are disabled by default.
 * Enabling either gate requires an explicit approved deployment/test configuration.
 * No client-supplied URL, redirect or credential is accepted.
 */
export function createLiveTransport({ getApiKey, fetchImpl = globalThis.fetch,
  enableLiveRequests = false, enableLiveWrites = false, approvedTestJobIds = [] } = {}) {
  return async request => {
    requireValue(enableLiveRequests, 'LIVE_REQUESTS_DISABLED', 503);
    const read = request.method === 'GET' &&
      (/^\/jobs\?page=\d+&page_size=100$/.test(request.path) || /^\/jobs\/[^/?#]+(?:\/line_items)?$/.test(request.path));
    const writeMatch = (request.method === 'POST' && /^\/jobs\/([^/?#]+)\/line_items$/.exec(request.path)) ||
      (request.method === 'PUT' && /^\/jobs\/([^/?#]+)\/line_items\/[^/?#]+$/.exec(request.path));
    requireValue(read || writeMatch, 'HCP_OPERATION_NOT_ALLOWED', 403);
    if (writeMatch) requireValue(enableLiveWrites && approvedTestJobIds.includes(decodeURIComponent(writeMatch[1])),
      'LIVE_WRITES_DISABLED', 403);
    requireValue(typeof getApiKey === 'function', 'SERVER_CREDENTIAL_UNAVAILABLE', 503);
    const key = await getApiKey();
    requireValue(typeof key === 'string' && key.length > 0 && !/[\r\n]/.test(key),
      'SERVER_CREDENTIAL_UNAVAILABLE', 503);
    const url = new URL(request.path, 'https://api.housecallpro.com');
    requireValue(url.origin === 'https://api.housecallpro.com', 'HCP_OPERATION_NOT_ALLOWED', 403);
    try {
      const response = await fetchImpl(url, { method: request.method, redirect: 'error',
        signal: AbortSignal.timeout(15000), headers: { Authorization: `Token ${key}`,
          Accept: 'application/json', ...(request.body ? { 'Content-Type': 'application/json' } : {}) },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}) });
      let body = null;
      if (response.ok) { try { body = await response.json(); } catch { /* service treats malformed 201 as uncertain */ } }
      return { status: response.status, body };
    } catch { throw new IntegrationError('HCP_TRANSPORT_FAILED', 502); }
  };
}

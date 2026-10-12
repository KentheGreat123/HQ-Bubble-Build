export class IntegrationError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function requireValue(condition, code = 'INVALID_REQUEST', status = 400) {
  if (!condition) throw new IntegrationError(code, status);
}

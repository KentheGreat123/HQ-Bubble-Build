import { requireValue } from './errors.mjs';

/** Server-owned registry. Factories receive a persisted account connection, never
 * a browser-selected platform or credentials. No ServiceTitan adapter exists yet.
 * Contract: findJobsByNumber(number), getJob(id), postMaterial(id, material).
 * Jobs: {id, jobNumber, customerName, street, description, available}.
 * Materials use integer cents and a numeric quantity; post returns {id, ...material}.
 * Adapters must reject foreign external accounts and validate remote responses.
 */
export class JobMaterialsRegistry {
  constructor(factories) { this.factories = new Map(Object.entries(factories)); }
  forConnection(connection) {
    const factory = this.factories.get(connection.platform);
    requireValue(factory, 'PLATFORM_NOT_IMPLEMENTED', 503);
    const adapter = factory(Object.freeze({ ...connection }));
    requireValue(adapter && ['findJobsByNumber', 'getJob', 'postMaterial', 'verifyMaterial','inspectMaterial','recheckMaterial','updateMaterial']
      .every(method => typeof adapter[method] === 'function'), 'ADAPTER_INVALID', 503);
    return adapter;
  }
}

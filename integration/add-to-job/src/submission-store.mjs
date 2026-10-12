import { DatabaseSync } from 'node:sqlite';
import { requireValue } from './errors.mjs';

/** Use a protected persistent path in deployment; :memory: is only for mocks.
 * Unique claims commit BEFORE the remote POST. A crash leaves an unresolved claim,
 * preventing an automatic duplicate POST after restart.
 */
export class SqliteSubmissionStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS confirmations (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, job_id TEXT NOT NULL,
        job_number TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS submissions (
        scope TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
        state TEXT NOT NULL, result TEXT, job_id TEXT, payload TEXT, created_at INTEGER,
        PRIMARY KEY(scope, request_key));
      CREATE TABLE IF NOT EXISTS account_connections (
        account_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, platform TEXT NOT NULL,
        external_account_id TEXT NOT NULL, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS material_quotes (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
    // Additive migration preserves existing durable claims and results.
    const columns = this.db.prepare('PRAGMA table_info(submissions)').all().map(c => c.name);
    for (const column of ['account_id', 'owner_id', 'reservation_id']) {
      if (!columns.includes(column)) this.db.exec(`ALTER TABLE submissions ADD COLUMN ${column} TEXT`);
    }
  }
  /** Trusted provisioning only. Never expose this method as an unauthenticated
   * client endpoint. Replacement is atomic and blocked by unfinished operations.
   * IDs represent credential bindings in a server secret manager, not secrets.
   */
  connect({ accountId, id, platform, externalAccountId }) {
    requireValue([accountId, id, platform, externalAccountId].every(v => typeof v === 'string' && v.length > 0));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      requireValue(!this.db.prepare("SELECT 1 FROM submissions WHERE (account_id = ? OR account_id IS NULL) AND state <> 'confirmed' LIMIT 1")
        .get(accountId), 'CONNECTION_HAS_UNRESOLVED_SUBMISSIONS', 409);
      const old = this.connection(accountId);
      this.db.prepare(`INSERT INTO account_connections VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET id=excluded.id, platform=excluded.platform,
        external_account_id=excluded.external_account_id, version=excluded.version`)
        .run(accountId, id, platform, externalAccountId, (old?.version ?? 0) + 1);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  connection(accountId) {
    const row = this.db.prepare('SELECT * FROM account_connections WHERE account_id = ?').get(accountId);
    return row && { accountId: row.account_id, id: row.id, platform: row.platform,
      externalAccountId: row.external_account_id, version: row.version };
  }
  saveQuote({ id, scope, data, expiresAt }) {
    this.db.prepare('INSERT INTO material_quotes VALUES (?, ?, ?, ?)').run(id, scope, JSON.stringify(data), expiresAt);
  }
  quote(id) { return this.db.prepare('SELECT * FROM material_quotes WHERE id = ?').get(id); }
  saveConfirmation(c) {
    this.db.prepare('INSERT INTO confirmations VALUES (?, ?, ?, ?, ?)')
      .run(c.id, c.scope, c.jobId, c.jobNumber, c.expiresAt);
  }
  getConfirmation(id) { return this.db.prepare('SELECT * FROM confirmations WHERE id = ?').get(id); }
  get(scope, key) { return this.db.prepare('SELECT * FROM submissions WHERE scope = ? AND request_key = ?').get(scope, key); }
  materialIds(scope,jobId,sku) {
    return this.db.prepare("SELECT result,json_extract(payload,'$.sku') as sku FROM submissions WHERE scope=? AND job_id=? AND result IS NOT NULL")
      .all(scope,jobId).map(row=>({id:JSON.parse(row.result)?.material?.id,sku:row.sku})).filter(row=>row.id);
  }
  cancelUndispatched(scope,key) {
    requireValue(this.db.prepare("UPDATE submissions SET state='failed' WHERE scope=? AND request_key=? AND state='reserved'").run(scope,key).changes===1,'SUBMISSION_UNKNOWN',409);
  }
  rejectUpdate(scope,key) {
    requireValue(this.db.prepare("UPDATE submissions SET state='failed' WHERE scope=? AND request_key=? AND state='dispatching'").run(scope,key).changes===1,'SUBMISSION_UNKNOWN',409);
  }
  claim(scope, key, fingerprint, jobId = null, payload = null, metadata = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
    if (metadata.accountId) {
      const current = this.connection(metadata.accountId);
      requireValue(current && current.id === metadata.connectionId && current.version === metadata.connectionVersion,
        'CONNECTION_CHANGED', 409);
    }
    requireValue(!this.db.prepare("SELECT 1 FROM submissions WHERE scope=? AND job_id=? AND json_extract(payload,'$.sku')=? AND request_key<>? AND state NOT IN ('confirmed','failed') LIMIT 1")
      .get(scope,jobId,payload?.sku ?? null,key),'MATERIAL_OPERATION_IN_PROGRESS',409);
    const claimed = this.db.prepare(`INSERT OR IGNORE INTO submissions
      (scope, request_key, fingerprint, state, job_id, payload, created_at, account_id, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(scope, key, fingerprint, 'pending', jobId, payload ? JSON.stringify(payload) : null, Date.now(),
        metadata.accountId ?? null, metadata.ownerId ?? null).changes === 1;
    this.db.exec('COMMIT'); return claimed;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  reserved(scope, key, reservationId) {
    this.db.prepare('UPDATE submissions SET state = ?, reservation_id = ? WHERE scope = ? AND request_key = ?')
      .run('reserved', reservationId, scope, key);
  }
  materialCreated(scope, key, result) {
    this.db.prepare('UPDATE submissions SET state = ?, result = ? WHERE scope = ? AND request_key = ?')
      .run('inventory_pending', JSON.stringify(result), scope, key);
  }
  dispatching(scope, key) {
    requireValue(this.db.prepare("UPDATE submissions SET state='dispatching' WHERE scope=? AND request_key=? AND state='reserved'")
      .run(scope, key).changes === 1, 'SUBMISSION_UNKNOWN', 409);
  }
  remoteCreated(scope, key, result) {
    this.db.prepare('UPDATE submissions SET state = ?, result = ? WHERE scope = ? AND request_key = ?')
      .run('verification_pending', JSON.stringify(result), scope, key);
  }
  complete(scope, key, result) {
    this.db.prepare('UPDATE submissions SET state = ?, result = ? WHERE scope = ? AND request_key = ?')
      .run('confirmed', JSON.stringify(result), scope, key);
  }
  unknown(scope, key) {
    this.db.prepare('UPDATE submissions SET state = ? WHERE scope = ? AND request_key = ?')
      .run('unknown', scope, key);
  }
  close() { this.db.close(); }
}

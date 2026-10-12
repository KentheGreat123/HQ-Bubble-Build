// Explicit two-stage probe for a disposable native PostgreSQL server. The server
// must be stopped/restarted between prepare and verify by the test operator.
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {seed,workflow,principal} from './support.mjs';
const url=new URL(process.env.HQ_NATIVE_TEST_URL||'http://invalid');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/hq_phase1_test','Dedicated localhost test database required');
const client=new Client({connectionString:url.href});await client.connect();
const db={query:(...args)=>client.query(...args),exec:sql=>client.query(sql)};
try{
 const w=workflow(db),key='native-restart-request-0001';
 if(['prepare','prepare-update'].includes(process.argv[2])){
  await seed(db);
  if(process.argv[2]==='prepare-update')await w.service.addMaterial(principal,await w.command('2','restart-existing-0001'));
  const command=await w.command(process.argv[2]==='prepare-update'?'1':'2',key);w.setFailure('lost');
  await assert.rejects(w.service.addMaterial(principal,command),e=>e.code==='SUBMISSION_UNKNOWN');
  assert.equal(w.lines.length,1);
  console.log('Prepared durable unknown submission with dispatch intent and a held reservation.');
 }else{
  assert.equal(process.argv[2],'verify');
  const r=(await db.query('select state,dispatched_at,payload from hq_private.material_submissions where request_key=$1',[key])).rows[0];
  assert.equal(r.state,'unknown');assert.ok(r.dispatched_at);
  const status=await w.service.submissionStatus(principal,{idempotencyKey:key});assert.equal(status.status,'reconciliation_required');
  const quote=(await db.query('select id,data from hq_private.material_quotes where data->\'material\'=$1::jsonb',[JSON.stringify(r.payload)])).rows[0];
  await assert.rejects(w.service.addMaterial(principal,{confirmationId:quote.data.confirmationId,quoteId:quote.id,sku:r.payload.sku,quantity:r.payload.quantity,idempotencyKey:key,...(r.payload.update?{confirmQuantityUpdate:true}:{})}),e=>e.code==='SUBMISSION_UNKNOWN');
  await assert.rejects(w.service.recoverInventory(principal,{idempotencyKey:key}),e=>e.code==='MANUAL_RECONCILIATION_REQUIRED');
  assert.equal(w.calls.length,0);
  const b=(await db.query('select on_hand::text,reserved::text from public.hq_inventory_balances')).rows[0];
  assert.deepEqual(b,r.payload.update?{on_hand:'8.00',reserved:'1.00'}:{on_hand:'10.00',reserved:'2.00'});
  assert.equal((await db.query('select count(*)::int n from public.hq_inventory_ledger')).rows[0].n,r.payload.update?1:0);
  console.log('PASS: server restart preserved uncertainty and inventory hold; recovery made zero remote requests.');
 }
}finally{await client.end();}

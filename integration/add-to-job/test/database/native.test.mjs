import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {seed,workflow,ids,principal} from './support.mjs';
const url=process.env.HQ_NATIVE_TEST_URL;
if(!url)throw new Error('Set HQ_NATIVE_TEST_URL to the dedicated localhost /hq_phase1_test database; initialize it using postgres.test.mjs first.');
const parsed=new URL(url);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.pathname!=='/hq_phase1_test')throw new Error('Refusing non-local/non-test PostgreSQL target');
let main;const clients=[];
async function connection(){const c=new Client({connectionString:url});await c.connect();clients.push(c);return{query:(...a)=>c.query(...a),exec:s=>c.query(s)};}
before(async()=>{main=await connection();});beforeEach(()=>seed(main));after(async()=>{await Promise.all(clients.map(c=>c.end()));});

test('eight native PostgreSQL sessions contend for one key and make one remote POST/stock commit',async()=>{
 const remote=workflow(main),cmd=await remote.command();
 const transport=async request=>{if(request.method==='POST')await new Promise(r=>setTimeout(r,100));return remote.transport(request);};
 const workers=await Promise.all(Array.from({length:8},async()=>workflow(await connection(),{transport})));
 await Promise.allSettled(workers.map(w=>w.service.addMaterial(principal,cmd)));
 assert.equal(remote.calls.filter(c=>c.method==='POST').length,1);assert.equal(remote.lines.length,1);
 const r=await main.query('select on_hand::text,reserved::text from public.hq_inventory_balances');assert.deepEqual(r.rows[0],{on_hand:'8.00',reserved:'0.00'});
 assert.equal((await main.query('select count(*)::int n from public.hq_inventory_ledger')).rows[0].n,1);
});
test('native sessions competing for limited stock cannot oversell',async()=>{
 const remote=workflow(main),a=await remote.command('6','native-stock-0001'),b=await remote.command('6','native-stock-0002');
 const first=workflow(await connection(),{transport:remote.transport}),second=workflow(await connection(),{transport:remote.transport});
 const result=await Promise.allSettled([first.service.addMaterial(principal,a),second.service.addMaterial(principal,b)]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(remote.lines.length,1);
 assert.deepEqual((await main.query('select on_hand::text,reserved::text from public.hq_inventory_balances')).rows[0],{on_hand:'4.00',reserved:'0.00'});
});
test('connection rotation and native claims serialize without leaving unfinished operations on an obsolete binding',async()=>{
 const remote=workflow(main),cmd=await remote.command();
 const creator=workflow(await connection(),{transport:remote.transport}),administrator=workflow(await connection(),{principal:{id:ids.admin,accountId:ids.a}});
 await Promise.allSettled([creator.service.addMaterial(principal,cmd),administrator.rpc('configure_connection',{connectionId:ids.c,vaultSecretId:ids.secret,activate:true,companyVerified:true})]);
 const r=await main.query("select count(*)::int n from hq_private.material_submissions s join public.hq_platform_connections c on c.id=s.connection_id where s.state not in ('confirmed','failed') and (s.connection_version<>c.version or c.status<>'active')");
 assert.equal(r.rows[0].n,0);assert.ok(remote.lines.length<=1);
});

test('native concurrent duplicate update taps increment the existing line and debit additional stock only once',async()=>{
 const remote=workflow(main);await remote.service.addMaterial(principal,await remote.command('2','native-existing-0001'));
 const cmd=await remote.command('1','native-update-0001');
 const transport=async request=>{if(request.method==='PUT')await new Promise(r=>setTimeout(r,100));return remote.transport(request);};
 const workers=await Promise.all(Array.from({length:8},async()=>workflow(await connection(),{transport})));
 await Promise.allSettled(workers.map(w=>w.service.addMaterial(principal,cmd)));
 assert.equal(remote.calls.filter(c=>c.method==='PUT').length,1);assert.equal(remote.lines.length,1);assert.equal(remote.lines[0].quantity,3);
 assert.deepEqual((await main.query('select on_hand::text,reserved::text from public.hq_inventory_balances')).rows[0],{on_hand:'7.00',reserved:'0.00'});
 assert.equal((await main.query('select count(*)::int n from public.hq_inventory_ledger')).rows[0].n,2);
});
test('native competing update keys cannot both increase the same reviewed quantity',async()=>{
 const remote=workflow(main);await remote.service.addMaterial(principal,await remote.command('2','native-create-0001'));
 const a=await remote.command('1','competing-update-0001'),b=await remote.command('1','competing-update-0002');
 const one=workflow(await connection(),{transport:remote.transport}),two=workflow(await connection(),{transport:remote.transport});
 const r=await Promise.allSettled([one.service.addMaterial(principal,a),two.service.addMaterial(principal,b)]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(remote.calls.filter(c=>c.method==='PUT').length,1);assert.equal(remote.lines[0].quantity,3);
 assert.deepEqual((await main.query('select on_hand::text,reserved::text from public.hq_inventory_balances')).rows[0],{on_hand:'7.00',reserved:'0.00'});
});

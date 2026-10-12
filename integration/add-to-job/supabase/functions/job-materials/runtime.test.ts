import assert from 'node:assert/strict';
import {createCloudHandler} from '../../../src/cloud-handler.mjs';
import {MaterialService} from '../../../src/material-service.mjs';
import {JobMaterialsRegistry} from '../../../src/job-materials.mjs';

Deno.test('SDK preflight permits required headers only for the exact production origin',async()=>{
 const origin='https://kenthegreat123.github.io';
 const handler=createCloudHandler({auth:{getUser:()=>assert.fail('Preflight must not authenticate')},admin:{rpc:()=>assert.fail('Preflight must not call RPC')},allowedOrigins:[origin]});
 const preflight=(value:string)=>handler(new Request('https://edge.example/job-materials/api/hq/jobs/resolve',{method:'OPTIONS',headers:{origin:value,'access-control-request-method':'POST','access-control-request-headers':'authorization,apikey,content-type,x-client-info,x-hq-account'}}));
 const r=await preflight(origin);assert.equal(r.status,204);
 assert.equal(r.headers.get('access-control-allow-origin'),origin);
 const headers=r.headers.get('access-control-allow-headers')!.split(',');
 for(const name of ['authorization','apikey','content-type','x-client-info','x-hq-account'])assert.ok(headers.includes(name));
 assert.equal(r.headers.get('access-control-allow-methods'),'POST,OPTIONS');
 assert.equal(r.headers.get('vary'),'Origin');
 for(const foreign of ['https://foreign.example','http://localhost:3000','null',origin+'/1st-Rate-Parts-App/',origin+'.evil.example']){
  const denied=await preflight(foreign);assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
 }
});

Deno.test('Deno runtime denies unverified sessions, foreign origins and live HCP traffic',async()=>{
 const admin={rpc:async (_:string,args:any)=>({data:args.p_op==='authorize'?true:
 {id:'00000000-0000-4000-8000-000000000021',platform:'housecallpro',externalAccountId:'fake-company',version:1},error:null})};
 const auth={getUser:async(token:string)=>token==='verified-fixture'?{data:{user:{id:'00000000-0000-4000-8000-000000000011'}},error:null}:{data:null,error:{message:'invalid'}}};
 const handler=createCloudHandler({auth,admin,allowedOrigins:['https://hq.example']});
 const request=(token:string,origin='https://hq.example')=>new Request('https://edge.example/job-materials/api/hq/jobs/resolve',{
  method:'POST',headers:{authorization:'Bearer '+token,'x-hq-account':'00000000-0000-4000-8000-000000000001',origin,'content-type':'application/json'},body:JSON.stringify({jobNumber:'4187'})});
 assert.equal((await handler(request('invalid'))).status,401);
 assert.equal((await handler(request('verified-fixture','https://foreign.example'))).status,403);
 const r=await handler(request('verified-fixture'));assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'LIVE_REQUESTS_DISABLED'});
});

Deno.test('shared asynchronous service uses Web Crypto and read-back before committing in Edge runtime',async()=>{
 const p={id:'fixture-user',accountId:'fixture-account'},connection={accountId:p.accountId,id:'fixture-connection',version:1,platform:'fake'};
 const confirmations=new Map(),quotes=new Map(),submissions=new Map(),events:string[]=[];
 const store={connection:async()=>connection,materialIds:async()=>[],saveConfirmation:async(c:any)=>{confirmations.set(c.id,{...c,job_id:c.jobId,job_number:c.jobNumber,expires_at:c.expiresAt});},
 getConfirmation:async(id:string)=>confirmations.get(id),saveQuote:async(q:any)=>{quotes.set(q.id,{...q,data:JSON.stringify(q.data),expires_at:q.expiresAt});},quote:async(id:string)=>quotes.get(id),
 get:async(_:string,key:string)=>submissions.get(key),claim:async(_:string,key:string,fingerprint:string,_id:string,payload:any)=>{submissions.set(key,{owner_id:p.id,fingerprint,payload:JSON.stringify(payload),state:'pending'});return true;},
 reserved:async(_:string,key:string)=>{submissions.get(key).state='reserved';},dispatching:async()=>{events.push('dispatch');},
 remoteCreated:async(_:string,key:string,result:any)=>{Object.assign(submissions.get(key),{state:'verification_pending',result:JSON.stringify(result)});events.push('remote-recorded');},
 materialCreated:async(_:string,key:string,result:any)=>{Object.assign(submissions.get(key),{state:'inventory_pending',result:JSON.stringify(result)});},
 complete:async(_:string,key:string,result:any)=>{Object.assign(submissions.get(key),{state:'confirmed',result:JSON.stringify(result)});},unknown:async()=>{assert.fail('unexpected unknown');}};
 const registry=new JobMaterialsRegistry({fake:()=>({findJobsByNumber:async()=>[{id:'job-fixture',jobNumber:'4187',available:true}],getJob:async()=>({id:'job-fixture',jobNumber:'4187',available:true}),
 postMaterial:async(_:string,m:any)=>{events.push('post');return{id:'line-fixture',...m};},verifyMaterial:async(_:string,id:string,m:any)=>{events.push('read-back');return{id,...m};},inspectMaterial:async()=>null,recheckMaterial:async()=>{},updateMaterial:async()=>{throw new Error('No update fixture');}})});
 const service=new MaterialService({registry,store,inventory:{reserve:async()=> 'reservation-fixture',commit:async()=>{events.push('commit');}},authorizeAction:async()=>true,authorizeJob:async()=>true,
 getPart:async()=>({accountId:p.accountId,sku:'ACTUAL-SKU',name:'Actual selection',unitPriceCents:1000,unitCostCents:500,taxable:true})});
 const c=await service.resolveJob(p,'4187'),selection={confirmationId:c.confirmationId,sku:'ACTUAL-SKU',quantity:'2'},q=await service.prepareMaterial(p,selection);
 const command={...selection,quoteId:q.quoteId,idempotencyKey:'deno-request-0001'};
 assert.equal((await service.addMaterial(p,command)).status,'confirmed');assert.equal((await service.addMaterial(p,command)).status,'confirmed');
 assert.deepEqual(events,['dispatch','post','remote-recorded','read-back','commit']);
});

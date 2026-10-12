import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCloudHandler} from '../src/cloud-handler.mjs';

test('production SDK preflight accepts x-client-info and rejects unapproved origins',async()=>{
 const origin='https://kenthegreat123.github.io';
 const h=createCloudHandler({auth:{getUser:()=>assert.fail('Unexpected Auth call')},admin:{rpc:()=>assert.fail('Unexpected RPC')},allowedOrigins:[origin]});
 for(const candidate of [origin,'http://localhost:3000','null',origin+'/1st-Rate-Parts-App/',origin+'.evil.example']){
  const r=await h(new Request('https://edge.example/job-materials/api/hq/jobs/resolve',{method:'OPTIONS',headers:{origin:candidate,'access-control-request-method':'POST','access-control-request-headers':'authorization,apikey,content-type,x-client-info,x-hq-account'}}));
  assert.equal(r.status,candidate===origin?204:403);
  assert.equal(r.headers.get('access-control-allow-origin'),candidate===origin?origin:null);
  if(candidate===origin){
   assert.deepEqual(r.headers.get('access-control-allow-headers').split(','),['authorization','apikey','content-type','x-client-info','x-hq-account']);
   assert.equal(r.headers.get('access-control-allow-methods'),'POST,OPTIONS');
   assert.equal(r.headers.get('vary'),'Origin');
  }
 }
});

test('deployment origin configuration cannot widen production-only admission or enable HCP',()=>{
 const code=readFileSync(new URL('../supabase/functions/job-materials/index.ts',import.meta.url),'utf8');
 assert.match(code,/const approvedOrigin = 'https:\/\/kenthegreat123\.github\.io'/);
 assert.match(code,/\.filter\(s=>s===approvedOrigin\)/);
 assert.match(code,/allowedOrigins,/);
 assert.match(code,/enableLiveRequests:false,enableLiveWrites:false,approvedTestJobIds:\[\]/);
});

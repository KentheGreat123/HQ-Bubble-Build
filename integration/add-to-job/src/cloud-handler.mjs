import {IntegrationError,requireValue} from './errors.mjs';
import {MaterialService} from './material-service.mjs';
import {JobMaterialsRegistry} from './job-materials.mjs';
import {HcpClient,createLiveTransport} from './hcp-client.mjs';
import {HousecallProJobMaterialsAdapter} from './hcp-adapter.mjs';
import {createHandler} from './http-handler.mjs';
import {createBackendRpc,PostgresSubmissionStore,PostgresInventory} from './postgres-store.mjs';
import {reconcileMaterial} from './reconciliation.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const paths=['/api/hq/jobs/resolve','/api/hq/materials/prepare','/api/hq/materials','/api/hq/materials/status','/api/hq/materials/recover'];
function publicResult(value) {
  if(Array.isArray(value))return value.map(publicResult);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='unitCostCents').map(([key,v])=>[key,publicResult(v)]));
  return value;
}
/** @param {{auth:any,admin:any,allowedOrigins?:string[],transportFactory?:(connection:any)=>any,enableLiveRequests?:boolean,enableLiveWrites?:boolean,approvedTestJobIds?:string[]}} options */
export function createCloudHandler({auth,admin,allowedOrigins=[],transportFactory,enableLiveRequests=false,enableLiveWrites=false,approvedTestJobIds=[]}) {
  requireValue(auth?.getUser && admin?.rpc);
  return async request=>{
    const origin=request.headers.get('origin');const headers={'Cache-Control':'no-store','Vary':'Origin'};
    const json=(body,status)=>Response.json(body,{status,headers});
    if(origin&&!allowedOrigins.includes(origin))return json({error:'ORIGIN_NOT_ALLOWED'},403);
    if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-hq-account','Access-Control-Allow-Methods':'POST,OPTIONS'});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    try {
      const token=/^Bearer (\S+)$/.exec(request.headers.get('authorization')||'')?.[1];
      requireValue(token,'UNAUTHENTICATED',401);
      // getUser validates the session with Supabase Auth; decoding JWTs/PINs/user_metadata is not authorization.
      const {data,error}=await auth.getUser(token);
      requireValue(!error && data?.user && uuid.test(data.user.id) && !data.user.is_anonymous,'UNAUTHENTICATED',401);
      const accountId=request.headers.get('x-hq-account');requireValue(accountId&&uuid.test(accountId),'ACCOUNT_REQUIRED',400);
      const principal={id:data.user.id,accountId};const rpc=createBackendRpc(admin,principal);
      requireValue(await rpc('authorize',{action:'read'}),'FORBIDDEN',403);
      const store=new PostgresSubmissionStore({rpc,principal}),inventory=new PostgresInventory({rpc,principal});
      const registry=new JobMaterialsRegistry({housecallpro:connection=>{
        const transport=transportFactory?transportFactory(connection):createLiveTransport({
          getApiKey:()=>rpc('credential',{connectionId:connection.id,version:connection.version}),
          enableLiveRequests,enableLiveWrites,approvedTestJobIds});
        return new HousecallProJobMaterialsAdapter({client:new HcpClient({transport,maxPages:5}),externalAccountId:connection.externalAccountId});
      }});
      const service=new MaterialService({store,inventory,registry,
        authorizeAction:(_,action)=>rpc('authorize',{action}),authorizeJob:()=>rpc('authorize',{action:'jobs:read'}),
        getPart:sku=>rpc('part',{sku})});
      const url=new URL(request.url);
      // Fixed deployment mount; no arbitrary suffix matching or client-selected upstream URL.
      const path=url.pathname.replace(/^\/functions\/v1\/job-materials(?=\/)/,'').replace(/^\/job-materials(?=\/)/,'');
      if(path==='/api/hq/materials/reconcile') {
        requireValue(request.method==='POST' && request.headers.get('content-type')?.split(';')[0]==='application/json','INVALID_REQUEST');
        const reader=request.body?.getReader();requireValue(reader);let text='',bytes=0;const decoder=new TextDecoder();
        while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>16384){await reader.cancel();throw new IntegrationError('REQUEST_TOO_LARGE',413);}text+=decoder.decode(value,{stream:true});}
        let input;try{input=JSON.parse(text+decoder.decode());}catch{throw new IntegrationError('INVALID_REQUEST');}
        const result=await reconcileMaterial({rpc,registry},input);
        return json(publicResult(result),result.status==='inventory_pending'?202:200);
      }
      requireValue(paths.includes(path),'NOT_FOUND',404);url.pathname=path;
      const response=await createHandler({service,authenticate:async()=>principal})(new Request(url,request));
      return json(publicResult(await response.json()),response.status);
    } catch(e) {return json({error:e instanceof IntegrationError?e.code:'INTERNAL_ERROR'},e instanceof IntegrationError?e.status:500);}
  };
}

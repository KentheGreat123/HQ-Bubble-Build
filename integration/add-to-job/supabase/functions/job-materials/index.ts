import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { createCloudHandler } from '../../../src/cloud-handler.mjs';

const url = Deno.env.get('SUPABASE_URL');
const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !publicKey || !serverKey) throw new Error('Required Supabase server configuration missing');
const options = { auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } };
const userClient = createClient(url,publicKey,options);
const admin = createClient(url,serverKey,options);
// Hosted Phase 1 permits only the approved production origin. Configuration
// cannot widen this policy; an unset value continues to fail closed.
const approvedOrigin = 'https://kenthegreat123.github.io';
const allowedOrigins = (Deno.env.get('HQ_ALLOWED_ORIGINS')||'').split(',')
 .map(s=>s.trim()).filter(s=>s===approvedOrigin);
// Live traffic is intentionally hard-disabled in Phase 1. Changing these gates
// requires separate approval, designated test-job configuration and reviewed code.
const handler = createCloudHandler({auth:userClient.auth,admin,
 allowedOrigins,
 enableLiveRequests:false,enableLiveWrites:false,approvedTestJobIds:[]});
Deno.serve(handler);

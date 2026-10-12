# Server-side Add to Job — Phase 1 checkpoint

The bubble-add backend provides account-bound Supabase Auth/RLS, PostgreSQL
inventory and durable submission RPCs, restricted Vault access and a Deno Edge
Function. Its HCP adapter remains behind hard-disabled live reads/writes.
Nothing is deployed; production HQ and Android are outside this checkpoint.

Start with [supabase/DEPLOYMENT_CHECKLIST.md](supabase/DEPLOYMENT_CHECKLIST.md)
for current approvals, invite-only Auth, production-only CORS and recovery limits.
[supabase/README.md](supabase/README.md) documents API/testing and
[supabase/SCHEMA.md](supabase/SCHEMA.md) the database contract. Historical reports
retain earlier findings. REQUIREMENTS.md and the official contract snapshots
describe the captured HCP wire contract; no HCP lookup is needed for tests.

With Node 24+ and pinned dependencies, run from this directory:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run test:phase1
```

The Phase 1 suite uses mock HCP and embedded PostgreSQL with synthetic Auth/Vault.
It does not substitute for real Supabase runtime tests. Separate native/local
integration requires explicit opt-in and dedicated loopback test targets; never
run these tests against the imported recovery baseline or the hosted project.
Deno verification uses the pinned Windows development dependency.

Prototype UI/frontend/local mock lab, Android changes and their UI tests are
excluded from this checkpoint and may remain in the working tree. No staff
invites, frontend wiring, credential provisioning or HCP activation is authorized.

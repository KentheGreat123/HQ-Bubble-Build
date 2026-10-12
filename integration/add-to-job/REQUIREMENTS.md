# Add to Job: verified API requirements

Authority: the user's official [Add a line item to a Job](https://docs.housecallpro.com/docs/housecall-public-api/99ba8250597cd-add-a-line-item-to-a-job) endpoint. Reviewed October 11, 2026 before designing this module. The schema was retrieved from the public Stoplight data behind that page and cross-checked with HCP's [official OpenAPI export](https://stoplight.io/api/v1/projects/housecallpro/housecall-public-api/nodes/reference/housecall.v1.yaml?fromExportButton=true). This backend module is separate from the existing Android bubble code and public web repository.

## HTTP contract

- Base URL: `https://api.housecallpro.com`.
- Method/path: `POST /jobs/{job_id}/line_items`.
- Required path parameter: string `job_id`, the HCP internal job ID, not the displayed number.
- Body: JSON; `Content-Type: application/json`, `Accept: application/json`.
- Authentication: company API keys use the exact header `Authorization: Token <server-held-key>`. Official integration partners may use `Authorization: Bearer <server-held-OAuth-access-token>`. This module implements the company API-key route, not an OAuth enrollment/refresh service. Source: [HCP Authentication](https://docs.housecallpro.com/docs/housecall-public-api/b87d37ae48a0d-authentication). The operation inherits service authentication; an empty security array in a transformed operation snapshot must not be interpreted as anonymous access.

| Request field | Official type / requirement / meaning |
|---|---|
| `name` | string; the only field in the body schema's required list |
| `description` | optional string; no dedicated SKU field is documented, so the module includes the part number here |
| `kind` | optional string, default `labor`; enum `materials`, `labor`, `fixed gratuity`, `fixed discount`, `percent discount`. Always send `materials` for this feature |
| `unit_price` | optional number, default 0; selling price per unit in **cents**, so $46.10 is 4610 |
| `unit_cost` | optional number, default 0; direct company cost per unit in **cents**, used for job costing |
| `quantity` | optional number, default 1; supports fractional quantities with up to two decimal places |
| `taxable` | optional boolean, default true; server catalog/business policy supplies the explicit value |
| `service_item_id` | optional string identifying the related service/pricebook item |
| `service_item_type` | optional string; enum `market_place`, `organizational`, `pricebook_material` |

The backend applies stricter product rules: a real known SKU, positive quantity, nonnegative safe integer cents, authorization and confirmed job selection. These rules are not claimed to be additional HCP schema-required fields. Price/cost/tax/type come from an authoritative server catalog, never a technician-supplied price or the prototype's hardcoded values.

## Success and errors

The documented success is **201 Created**, with a direct JSON object (not a `data` envelope). Its properties are `id`, `name`, `description`, `unit_price`, `unit_cost`, `unit_of_measure`, `quantity`, `kind`, `taxable`, `amount`, `order_index`, `service_item_id`, and `service_item_type`. The response schema does not list required fields. The backend conservatively requires an ID and matching material type, quantity, price and cost before claiming confirmed success. `amount`, `order_index` and `unit_of_measure` are response fields, not documented create-body fields.

The endpoint's response map lists **only 201**. It does not enumerate negative response codes, error bodies, numerical rate limits or Retry-After guarantees. It explicitly calls this operation rate limited and recommends the separate bulk-update operation for multiple items on the same job. Do not invent missing error contracts. The overall specification has an `ErrorResponse` model containing `error.message`, but this operation does not reference it.

The tests defensively simulate 400/401/403/404/422/429/5xx, malformed 201, timeouts and transport failures. These are operational cases to handle, not a claim that every code is documented for this endpoint. No POST is automatically retried. Uncertain/failed submissions keep a durable record requiring reconciliation, especially after a timeout or process crash. Numerical rate limits must be confirmed before deployment.

## Resolving the correct job ID

The same official OpenAPI export documents:

1. `GET /jobs`: a paginated response with `jobs`, `page`, `page_size`, `total_pages`, `total_items`. Each Job has string `id` and `invoice_number` fields. The list query includes `page`/`page_size` and scheduled/customer/employee/status/location filters, but **no job-number/invoice-number filter**. `sort_by=invoice_number` sorts; it is not a lookup filter.
2. Match the entered display number exactly against `invoice_number` across all retrieved pages. Refuse no match, multiple distinct matching IDs, incomplete pagination or invalid responses. Do not assume the typed number is an ID. For scale, implement an authorized tenant-specific job index/background synchronization; the current module bounds direct scans and refuses incomplete results.
3. Authorize access, verify company, and show selected customer/address/job details. Store a short-lived confirmation tied to the authenticated technician and company.
4. Before posting, call documented `GET /jobs/{id}` and verify ID/number/company/permissions again. Reject locked/canceled/deleted jobs under this module's product policy.
5. Post to the ID in that verified confirmation, not an arbitrary client-supplied job ID.

The API Job model is described as a job segment. Ambiguous numbers are deliberately rejected; segment selection and fleet-specific display-number conventions must be validated with an approved test job before deployment.

## Line item versus job-cost input

This operation creates a **billable job line item** with a selling price, which affects the job's billed amount/invoice calculation; it does not itself send an invoice. `unit_cost` adds costing data to that line but does not turn it into an input-only record. HCP's separate `/jobs/{job_id}/job_input_materials` operations are for material job inputs. HCP explains that inputs do not change the job total or appear on the invoice: [Job Inputs and Flat Rate Services](https://help.housecallpro.com/en/articles/6973952-job-inputs-and-flat-rate-services).

## Boundaries and approval

No HCP credentials are present in these files, the public website or the APK. Tests use invented fixtures and injected mock transport. Real network requests are disabled by default; real POSTs additionally require an explicit write gate and designated approved test-job allowlist. No customer/test job has been contacted. Deploying/wiring the web feature and testing a designated real job require user approval.

## Platform-independent integration requirement

The shared Add to Job workflow must use the Job Materials interface described in
[ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md). These HCP wire/API requirements
belong to the HCP adapter, not the shared service or frontend. Each HQ account
may select only one server-owned platform connection at a time. ServiceTitan is
a future adapter; it is not implemented. Server-priced selection confirmation,
account/job permissions, durable submission identity and inventory coordination
are shared requirements. All adapters must preserve billable material semantics;
cost-input-only operations require a separately designed operation.

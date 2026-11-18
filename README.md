# Verdant Store

Verdant Store is a fictional organic skincare retailer used to demonstrate how a
business can keep its own e-commerce data while using the separate RetailTrace
Business-as-a-Service (BaaS) application for traceability records and
blockchain-backed verification.

The project includes a React storefront and integration dashboard. The frontend
communicates with Verdant Store's Express API; RetailTrace credentials remain
on the server.

## Project status

| Area | Status |
|---|---|
| React + TypeScript + Vite storefront and integration dashboard | Implemented |
| Express backend and health endpoint | Implemented and tested |
| PostgreSQL Docker Compose service | Implemented and tested |
| Prisma models, initial migration, and seed data | Implemented and tested |
| RetailTrace API client and server-side authentication | Contract-tested; current live RetailTrace smoke test passed |
| Verdant Supplier and Product schema initialization | Automated contract covered; local PostgreSQL integration not run in this session |
| RetailTrace schema initialization | Reuses matching schemas; creates a new schema when definitions differ because the current RetailTrace API has no update route |
| Supplier, Product, and Order synchronization | Automated tests cover scalar-reference and publication contracts |
| Failed synchronization and retry | Uncertain submissions are reconciled before any retry can submit again |
| Record and transaction verification | Uses RetailTrace record verification; transaction lookup is composed from record listing because no transaction endpoint exists |
| Supplier create/list/detail API and automatic synchronization | Implemented and API-tested |
| Product create/list/detail API and automatic synchronization | Implemented and API-tested |
| Order create/list/detail API and multiple-Product synchronization | Implemented; one scalar RetailTrace reference is emitted per OrderItem |
| Dashboard integration with the Verdant Store API | Implemented; displays RetailTrace transaction IDs and blockchain publication status |
| Backend automated tests | RetailTrace API contract, synchronization, Supplier/Product/Order API tests pass |

`syncStatus` tracks Verdant's record synchronization. `retailTraceStatus` and
`transactionId` track RetailTrace's blockchain publication result; a returned
record ID alone is not treated as blockchain confirmation.

## Business scenario

Verdant Store sells fictional organic skincare. It buys products from suppliers
such as Alpine Herb Collective in Switzerland and Botanical Coast Labs in New
Zealand. The business needs normal e-commerce data—suppliers, stock, orders, and
order items—in its own database. It also wants to publish selected supplier and
product facts to RetailTrace so they can be independently verified.

## Architecture

```mermaid
flowchart LR
  Browser["Browser"]
  Frontend["React + TypeScript + Vite<br/>integration dashboard"]
  Backend["Verdant Store Express API<br/>localhost:5001"]
  Postgres[("Verdant Store PostgreSQL<br/>localhost:5433")]
  RetailTrace["Separate RetailTrace BaaS<br/>localhost:5000"]
  Env["Backend environment<br/>API key stays server-side"]

  Browser --> Frontend
  Frontend -->|"Dashboard requests; no RetailTrace key"| Backend
  Backend <--> Postgres
  Backend -->|"Authenticated REST calls"| RetailTrace
  Env -. "Bearer key" .-> Backend
```

### Why PostgreSQL and RetailTrace are both used

PostgreSQL is the business application's operational database. It stores the
current Supplier, Product, Order, and OrderItem data that Verdant Store needs to
run its own business. Prisma provides typed access to those tables and manages
their migrations.

RetailTrace is an additional service, not a replacement for PostgreSQL. It
registers business-defined schemas, accepts selected business records, and
provides a blockchain-backed verification operation. The business backend
decides what to submit and keeps its own data and local-to-RetailTrace mapping.
This keeps the shop's operational database under the business's control while
adding an external traceability proof.

The browser does not call RetailTrace directly. The Express backend calls the
RetailTrace REST API with a server-side bearer API key. The key is never placed
in a frontend bundle or returned by a Verdant Store endpoint.

### What a reference means

The two systems have separate ID spaces:

- PostgreSQL uses local primary keys, such as the seeded
  `supplier-alpine-herb`.
- RetailTrace returns its own record IDs (24-character hexadecimal IDs in the
  live service).

When a Product is published, its RetailTrace `supplierId` field contains the
Supplier's **RetailTrace record ID**, not the PostgreSQL `supplierId` foreign
key. `RetailTraceSync` stores the mapping between a local entity and its
RetailTrace record. The RetailTrace schema's reference field separately names
the target **schema ID**; a record's reference value is the target **record
ID**.

### Blockchain-backed verification

Publishing a record gives the backend a RetailTrace record ID. The backend can
then call RetailTrace's record verification endpoint. RetailTrace reports
whether that record is verified and returns its transaction ID when available.
This project uses the response from RetailTrace; it does not operate a
blockchain node itself.

### If RetailTrace is unavailable

The business's PostgreSQL data remains local and is not deleted when RetailTrace
is unavailable. A failed Supplier/Product submission is recorded with
`syncStatus = FAILED` and an error message, and the retry endpoint can submit it
later. Requests to RetailTrace use a 10-second timeout. There is no background
retry queue today; retries are explicit.

Supplier, Product, and Order creation save each local record and its initial
`PENDING` `RetailTraceSync` row in one PostgreSQL transaction, then submit it
to RetailTrace. A RetailTrace failure leaves local business data intact and
returns the failed sync state for later retry.

## Technology

| Technology | Use |
|---|---|
| React 19, TypeScript, Vite 8 | Integration dashboard and frontend development server |
| Express 5, TypeScript | Business backend, JSON parsing, CORS, routes, and centralized errors |
| PostgreSQL 16 | Business-owned relational database, run locally with Docker Compose |
| Prisma ORM 7.10.1 | Database schema, migrations, generated typed client, and queries |
| Prisma PostgreSQL adapter + `pg` | PostgreSQL driver used by Prisma 7 |
| Axios | Server-side RetailTrace REST client; it is also installed in the frontend but not currently used there |
| `dotenv` | Loads backend environment variables from `backend/.env` |
| `cors` | Allows the configured Vite origin to call the business backend |
| ESLint | Frontend lint configuration |

React Router is installed in the frontend but no application routes have been
created yet. Package versions are defined by the respective package manifests
and lockfiles.

## Project structure

```text
.
├── README.md
├── docker-compose.yml
├── backend/
│   ├── .env                       # Local ignored settings; do not commit secrets
│   ├── package.json
│   ├── package-lock.json
│   ├── prisma.config.ts
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.ts
│   │   └── migrations/
│   │       └── 20261117140411_init/
│   └── src/
│       ├── app.ts
│       ├── server.ts
│       ├── config/
│       ├── controllers/
│       ├── middleware/
│       ├── routes/
│       └── services/
├── frontend/
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── public/
│   └── src/
│       ├── App.tsx                 # RetailTrace integration dashboard
│       ├── main.tsx
│       ├── App.css
│       ├── index.css
│       └── services/
│           └── api.ts              # Typed client for the Verdant Store API
└── backend/src/generated/prisma/  # Generated client; ignored by Git
```

The backend also generates `backend/dist/` on build. Dependency and generated
output directories are not source files.

## Frontend integration dashboard

The React dashboard calls only the Verdant Store backend. It does not call
RetailTrace directly, and no RetailTrace API key is included in frontend
configuration or browser requests.

The dashboard currently provides:

- Integration status, registered schema count, synchronization counts, and
  RetailTrace blockchain health.
- Schema names, IDs, and versions returned by the backend.
- A published-record list with a text search and per-record verification.
- An initialize action that reports complete or partial initialization.
- A retry form that accepts a local `RetailTraceSync` ID for a failed
  Supplier/Product synchronization.
- Refresh and visible error/status messages when a backend request fails.

The records and schemas shown are those returned by the configured RetailTrace
business account; the list is not limited to records created by the current
demo session. There are no Supplier/Product create forms, catalog, cart, or
checkout yet. Consequently, the dashboard cannot create new business records
to publish; it displays existing RetailTrace records and supports the existing
integration operations.

The frontend API client uses `VITE_API_BASE_URL` when set and otherwise calls
`http://localhost:5001`. Only the Verdant Store API base URL belongs in frontend
configuration; `RETAILTRACE_API_KEY` must remain in the backend environment.

## PostgreSQL and database

The root [docker-compose.yml](./docker-compose.yml) starts PostgreSQL 16:

| Setting | Value |
|---|---|
| Host/port | `localhost:5433` |
| Container port | `5432` |
| Database | `verdant_store` |
| User | `verdant_admin` |
| Data volume | `verdant_postgres_data` |

The development password is defined in `docker-compose.yml`; it is intentionally
not repeated here. Use those settings when connecting with DBeaver. Select the
`public` schema to inspect the tables. Avoid `docker compose down -v` unless you
intend to delete the persistent database volume.

### Prisma models

All models have an ID and timestamps where applicable. Prisma generates the
client into `backend/src/generated/prisma/`.

| Model | Purpose and important fields |
|---|---|
| `Supplier` | Supplier name, unique email, country, active flag (default `true`), timestamps |
| `Product` | Name, `Decimal(10,2)` price, integer stock quantity, organic flag, manufacturing date, and required Supplier foreign key |
| `Order` | Customer name, `Decimal(10,2)` total, string status (default `PENDING`), timestamps |
| `OrderItem` | Order/Product join with quantity and unit-price snapshot |
| `RetailTraceSync` | Local entity type and ID, nullable RetailTrace record ID, `PENDING`/`SYNCED`/`FAILED` state, nullable error, timestamps |
| `IntegrationConfig` | Single configuration row (`id = 1`) with nullable Supplier/Product/Order schema IDs, initialization flag, and timestamps |

Relationships and constraints:

- One Supplier has many Products; each Product belongs to one Supplier. The
  Product foreign key is indexed and deleting a Supplier with Products is
  restricted.
- One Order has many OrderItems; each OrderItem belongs to one Order and one
  Product. Deleting an Order cascades to its items; deleting a Product used by
  an item is restricted.
- `(orderId, productId)` is unique, so an Order has at most one line per
  Product.
- Supplier email is unique.
- `(entityType, localEntityId)` is unique in `RetailTraceSync`, preventing
  duplicate local synchronization mappings. `(entityType,
  retailTraceRecordId)` is also unique; PostgreSQL permits multiple `NULL`
  values in this unique index.
- `Order.status` is currently a string; `RetailTraceSync.syncStatus` is a
  database enum.

The initial migration is
`backend/prisma/migrations/20261117140411_init/migration.sql`.

### Seed data

`backend/prisma/seed.ts` uses upserts so it can be run repeatedly. It contains:

- 3 fictional suppliers: Alpine Herb Collective, Botanical Coast Labs, and
  Cedar & Bloom Botanicals.
- 5 organic skincare products associated with those suppliers.
- 2 sample orders with 5 OrderItems total.

Seeding writes local PostgreSQL data only; it does not automatically publish
those rows to RetailTrace.

## Backend and RetailTrace integration

The backend loads environment variables in `src/config/env.ts`, creates one
Prisma client in `src/config/database.ts`, and configures Express in
`src/app.ts`. The server connects to PostgreSQL before listening. The app
parses JSON, configures CORS for the Vite origin, mounts routes, returns a JSON
404 for unknown paths, and uses centralized error handling.

The RetailTrace client is in `src/services/retailtrace-api.service.ts`.
`src/services/integration.service.ts` initializes schemas, while
`src/services/sync.service.ts` publishes Supplier, Product, and Order data and
retries failed mappings.

### Environment variables

Create `backend/.env` locally. This file is ignored by Git. Do not copy real
credentials into this README, frontend variables, source files, screenshots, or
logs.

```dotenv
PORT=5001
DATABASE_URL=postgresql://<database-user>:<database-password>@localhost:5433/verdant_store?schema=public
RETAILTRACE_BASE_URL=http://localhost:5000/api
RETAILTRACE_API_KEY=<active RetailTrace bearer API key>
FRONTEND_ORIGIN=http://localhost:5173
```

`PORT`, `DATABASE_URL`, `RETAILTRACE_BASE_URL`, and `RETAILTRACE_API_KEY` are
required by the backend. `FRONTEND_ORIGIN` is optional and defaults to
`http://localhost:5173`. RetailTrace uses
`Authorization: Bearer <RETAILTRACE_API_KEY>` for its business API. The key
must remain server-side.

### Schema initialization and versioning

`POST /api/integration/initialize` registers schemas in dependency order:
Supplier, Product, then Order. It lists schemas and fetches their definitions
before reusing a matching ID. The current RetailTrace source exposes schema
creation and retrieval but no update route; when no matching definition exists,
Verdant creates a separate schema and saves its ID. Schema creation in
RetailTrace currently returns version `1`, including for same-name schemas.
IDs are persisted as each step completes so a partial initialization retains
successful earlier steps.

The registered fields are:

| Schema | Fields |
|---|---|
| Supplier | `name` string, `email` string, `country` string, `active` boolean |
| Product | `name` string, `price` number, `stockQuantity` integer, `organic` boolean, `manufacturedOn` date, `supplierId` reference to Supplier |
| Order | `customerName` string, `total` number, `status` string, `product1` reference to Product, `quantity1` integer |

RetailTrace supports scalar references using
`{ name, type: "reference", targetSchemaId, required }`. The target schema ID
belongs in the schema definition; record data contains the referenced
RetailTrace **record** ID. The current RetailTrace implementation does not
support array-valued references. For orders with multiple items, Verdant
creates/reuses an `Order-N-Products` schema with distinct scalar reference and
quantity fields for each line (`product1`, `quantity1`, etc.).

### Supplier and Product synchronization

`syncSupplier(localSupplierId)` loads the local Supplier, creates/reuses its
`RetailTraceSync` row, submits `name`, `email`, `country`, and `active` to the
Supplier schema, and stores the returned `data.recordId`.

`syncProduct(localProductId)` loads the Product and its local Supplier,
ensures the Supplier has a RetailTrace record ID, then submits the Product's
name, numeric price, stock quantity, organic flag, ISO date-time, and that
RetailTrace Supplier record ID. The date-time format matches RetailTrace's
`date` field validator. It never uses the PostgreSQL Supplier primary key as a
RetailTrace reference.

`syncOrder(localOrderId)` loads the local OrderItems, ensures each Product is
synchronized, then submits each RetailTrace Product record ID in its own
scalar reference field alongside that line's quantity. Items are ordered by
local Product ID for deterministic submissions; references always contain
RetailTrace IDs, never PostgreSQL IDs. A failed required Supplier or Product
sync prevents the Order record submission and leaves the Order mapping failed
for retry.

Each local entity has one unique synchronization mapping. If a record ID is
already stored, another sync/retry refreshes that record rather than
resubmitting it. Before POST, Verdant persists the submission timestamp and an
uncertain-outcome marker. If the response is lost or RetailTrace reports a
processing failure, retries look for an exact matching record created around
that attempt and recover its record/transaction IDs. If no match exists yet,
the sync remains pending; Verdant does not issue another POST. Multiple matches
are surfaced as ambiguous instead of being silently selected.

Supplier creation now calls `syncSupplier` automatically after the local
Supplier and pending sync mapping have been created transactionally. The
Supplier list and detail responses include their synchronization mapping.
`POST /api/products` also creates the Product and its `PENDING` sync mapping in
one PostgreSQL transaction, then calls `syncProduct`. That service first
ensures the local Supplier has a RetailTrace record ID and uses that
RetailTrace ID as the Product reference. The local PostgreSQL `supplierId` is
never sent as the RetailTrace reference. If Supplier synchronization fails,
Product synchronization fails visibly and remains retryable.

### Order synchronization representation

RetailTrace validates each reference as one 24-character record ID string.
Orders with N distinct Products therefore use N scalar reference fields rather
than an array. The generated Order schema also includes a quantity field for
each item; PostgreSQL remains the source for unit-price snapshots. A missing
or failed required Supplier/Product synchronization prevents Order publication.

## Express API

The local business API currently has no end-user authentication. Integration
routes use the server-side RetailTrace key when they call RetailTrace; the key
is not returned to callers. CORS is not an authentication mechanism.

| Method | Endpoint | Purpose | Auth | Status |
|---|---|---|---|---|
| `GET` | `/api/health` | Business backend health | None | Implemented and tested |
| `GET` | `/api/integration/status` | Local schema initialization and synchronization status | None | Implemented and tested |
| `GET` | `/api/integration/health` | RetailTrace blockchain health check | None locally; backend uses RetailTrace bearer key | Implemented and tested |
| `POST` | `/api/integration/initialize` | Reuse or create compatible RetailTrace schemas | None locally; backend uses RetailTrace bearer key | Implemented and tested |
| `GET` | `/api/integration/schemas` | List schemas owned by the configured RetailTrace business | None locally; backend uses RetailTrace bearer key | Implemented and tested |
| `GET` | `/api/integration/records` | List records owned by that RetailTrace business | None locally; backend uses RetailTrace bearer key | Implemented and tested |
| `POST` | `/api/integration/retry/:syncId` | Refresh or safely retry a Supplier, Product, or Order mapping | None locally; backend uses RetailTrace bearer key | Implemented and tested |
| `GET` | `/api/integration/records/:recordId/verify` | Ask RetailTrace to verify a record | None locally; backend uses RetailTrace bearer key | Implemented and tested |
| `GET` | `/api/integration/transactions/:transactionId/verify` | Find a record by transaction ID and verify that record | None locally; backend uses RetailTrace bearer key | Implemented; composed from RetailTrace record-list and record-verification endpoints |
| `POST` | `/api/suppliers` | Validate, save, and synchronize a Supplier | None | Implemented and API-tested |
| `GET` | `/api/suppliers` | List Suppliers with their sync state | None | Implemented and API-tested |
| `GET` | `/api/suppliers/:id` | Get a Supplier and its sync state | None | Implemented and API-tested |
| `POST` | `/api/products` | Validate the local Supplier, save, and synchronize a Product with its RetailTrace Supplier reference | None | Implemented and API-tested |
| `GET` | `/api/products` | List Products with local Supplier and sync state | None | Implemented and API-tested |
| `GET` | `/api/products/:id` | Get a Product, local Supplier, and sync state | None | Implemented and API-tested |
| `POST` | `/api/orders` | Validate Products, calculate totals, save OrderItems, and synchronize scalar Product references | None | Implemented and API-tested |
| `GET` | `/api/orders` | List Orders with line items and Product/Order sync state | None | Implemented and API-tested |
| `GET` | `/api/orders/:id` | Get an Order with line items and synchronization state | None | Implemented and API-tested |

Supplier creation accepts `name`, `email`, and `country`; `active` defaults to
`true`. Product creation accepts `name`, `price`, `stockQuantity`,
`manufacturedOn` (`YYYY-MM-DD`), and a local `supplierId`; `organic` defaults
to `false`. Order creation accepts `customerName` and a non-empty `items`
array of `{ productId, quantity }`. Product price snapshots and the Order
total are derived from local Product prices rather than client-supplied values.

Business create endpoints return HTTP 201 once the local transaction succeeds,
including when RetailTrace synchronization fails. Inspect the returned
`synchronization.syncStatus`, `retailTraceStatus`, `transactionId`, and
`errorMessage`; use the retry endpoint with that mapping's ID. This response
means local creation succeeded, not that blockchain publication is confirmed.

The business health endpoint returns `{ "status": "ok" }`. Integration
endpoints generally use `{ "success": true, "data": ... }`; integration
initialization includes a `status` of `initialized`, `partial`, or `failed`
inside `data`. Upstream errors are converted to a safe error response; no
request or response includes the API key.

## RetailTrace API contract used

The RetailTrace source used for compatibility exposes the following
authenticated business endpoints under the configured `/api` base URL:

| Method | RetailTrace path | Use |
|---|---|---|
| `GET` | `/health/blockchain` | Authenticated blockchain RPC health check |
| `GET` | `/schemas` | List the authenticated business's schema versions |
| `GET` | `/schemas/{schemaID}` | Read fields and reference targets before reusing a schema |
| `POST` | `/schemas` | Create a schema with `{ name, fields }` |
| `POST` | `/records` | Create `{ schemaId, data }`, synchronously publish, then return a record |
| `GET` | `/records` | List the authenticated business's records |
| `GET` | `/records/{recordId}` | Retrieve a record, including current status and transaction ID |
| `GET` | `/records/{recordId}/verify` | Verify a record and return `verified` and `transactionId` |

Successful RetailTrace responses use `{ "success": true, "data": ... }`;
record creation returns `data.recordId`, `data.transactionId`, and
`data.status`. The record ID is created before blockchain publication, and a
successful synchronous `publishfrom` returns a transaction ID with
`CONFIRMED`. Publication failures return an error while retaining the record
as `PENDING` for RetailTrace's reconciliation worker. Errors generally use
`{ "success": false, "error": { "code": "...", "message": "..." } }`.
Reference targets are declared by schema ID; each reference value is one
RetailTrace record ID. The current API has no schema-update route, no
array-valued reference support, and no transaction-specific verification route.
Verdant verifies a transaction by finding its record in `/records` and calling
that record's `/verify` endpoint.

In live testing, a malformed reference was rejected with
`INVALID_RECORD: Record data failed schema validation`, persisted locally as a
failed sync, then succeeded after retry with a valid Supplier record ID.

## Running the project

RetailTrace is a separate application and must be running at
`http://localhost:5000` with an active API key available to the backend.

### 1. Start PostgreSQL

From the project root:

```bash
docker compose up -d postgres
docker compose ps
```

### 2. Configure and start the backend

Create `backend/.env` using the variables above, substituting your local
database password and an active RetailTrace key. From the project root:

```bash
cd backend
npm ci
npm run db:generate
npm run db:migrate
npx prisma db seed
npm run dev
```

The backend listens on `http://localhost:5001`. `npm run db:migrate` runs
Prisma's local development migration command. The Prisma seed command is
configured in `prisma.config.ts`.

Other useful backend commands, run from `backend/`:

```bash
npm test
npm run typecheck
npm run build
npm start
npx prisma migrate status
```

### 3. Start the frontend

In a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Vite prints its local URL, normally `http://localhost:5173`. Open that URL for
the Verdant Store storefront; open `/admin` for the integration dashboard. If
the business backend uses another URL, set `VITE_API_BASE_URL` in the frontend
environment before starting Vite.
Frontend checks are:

```bash
npm run build
npm run lint
```

The storefront supports product browsing, checkout, order receipts, and record
verification. Supplier APIs can also be exercised directly. The
RetailTrace documentation UI is at
`http://localhost:5000/api/docs`.

### 4. Inspect the database

In DBeaver, connect to PostgreSQL at `localhost:5433`, database
`verdant_store`, using the username and local password configured by
`docker-compose.yml`. Expand the `public` schema to inspect the six business
tables and `_prisma_migrations`.

## Instructor demonstration guide

The storefront and dashboard demonstrate checkout, record synchronization,
schema initialization, blockchain status, verification, and retry:

1. Start RetailTrace, PostgreSQL, and the backend using the instructions above.
2. Open `http://localhost:5173` for the storefront and `/admin` for the
   integration dashboard. The dashboard reads integration status, schema
   count, synchronization state, and blockchain health through the business
   backend.
3. Use **Initialize schemas** to register or reuse the three schemas. The
   dashboard reports the initialization result; click it again to demonstrate
   idempotent reuse. The registered schema names, IDs, and versions are listed
   in the schema panel.
4. In the published-records panel, search for a record and use its **Verify**
   button to display RetailTrace's verification result and transaction ID.
5. Create a Supplier through the business API and inspect the response:

   ```bash
   curl -X POST http://localhost:5001/api/suppliers \
     -H 'content-type: application/json' \
     -d '{"name":"Demo Herb Cooperative","email":"demo-herbs@example.test","country":"Canada","active":true}'
   ```

   Use a new email for each run. A `FAILED` synchronization still leaves the
   Supplier saved locally and can be retried with
   `POST /api/integration/retry/{syncId}`.
6. Call `GET /api/suppliers` and `GET /api/suppliers/{id}` to show local data
   alongside its separate RetailTrace record ID and sync state.
7. In DBeaver, show the local Supplier row and its `RetailTraceSync` mapping.
   The Supplier APIs return a 409 response for duplicate email addresses.
8. Product creation can be demonstrated by using the local Supplier ID returned
   by the previous call:

   ```bash
   curl -X POST http://localhost:5001/api/products \
     -H 'content-type: application/json' \
     -d '{"name":"Calendula Recovery Balm","price":18.50,"stockQuantity":32,"organic":true,"manufacturedOn":"2026-09-10","supplierId":"<local-supplier-id>"}'
   ```

   The Product response should show a RetailTrace `SYNCED` status. Its submitted
   reference is the Supplier's RetailTrace record ID, not the local
   `supplierId`.
9. Create an Order with multiple Products through the business API:

   ```bash
   curl -X POST http://localhost:5001/api/orders \
     -H 'content-type: application/json' \
     -d '{"customerName":"Morgan Lee","items":[{"productId":"<local-product-id-1>","quantity":1},{"productId":"<local-product-id-2>","quantity":2}]}'
   ```

   Explain that PostgreSQL retains each quantity and price snapshot, while
   RetailTrace stores one scalar Product reference and quantity per item.
   `GET /api/orders` shows the local order and its sync status.
10. Explain that PostgreSQL remains the business database, while RetailTrace
   stores the separate traceability records and provides verification.

## Verification

The backend `npm test` command runs the node:test suite through `tsx`. Current
automated coverage includes RetailTrace request/response envelopes, pending
and confirmed publication, timeout/error handling, Supplier and Product
references, scalar Order references for multiple items, transaction ID
persistence, uncertain-submission recovery, and retry without duplicate POSTs.
The frontend does not currently have a separate automated test suite.
The final backend suite passed 22 tests, backend typecheck/build and Prisma
validation passed, and frontend production build and lint passed.

The current working RetailTrace service passed a live smoke test: its
authenticated health check was connected; three uniquely named test schemas
and four synthetic Supplier/Product/Order records were created; transaction
IDs were returned; both Supplier and multiple scalar Order references were
accepted; and record and transaction verification succeeded. These smoke-test
schemas and records were left in RetailTrace; no existing data was deleted.

The live test exercised RetailTrace directly, not the complete Verdant
PostgreSQL-backed application. Verdant's local backend (`localhost:5001`) and
PostgreSQL (`localhost:5433`) were unavailable, so the new additive migration
was not applied and a full Verdant-to-RetailTrace order workflow was not
claimed as end-to-end verified. Apply the migration with
`cd backend && npx prisma migrate deploy` when the configured database is
available. No QR generator or scanner is present in the current frontend
source; the existing record and transaction verification UI remains in place.

## Living documentation

Update this README in the same implementation stage whenever a meaningful
feature, endpoint, model, environment variable, or limitation changes. Keep
the implementation status and verification section limited to behavior that
has actually been implemented and tested.

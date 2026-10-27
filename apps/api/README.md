# NIQ Scoring backend API

This Bun/Hono service provides centrally managed rule evaluation, customer/deployment entitlements, face-scan workflows and AI-assisted report content. It serves NIQ staff administration requests and authenticated server-to-server requests from NIQ Application.

It remains on NIQ infrastructure when NIQ Application is installed in a customer's Ubuntu cloud. Patient registration, clinical approval, PDF rendering and file downloads belong to the separate Application backend.

## Main components

| Source area | Responsibility |
| --- | --- |
| `src/index.ts` | Environment validation, PostgreSQL connections, provider wiring, HTTP server and background ticks |
| `src/app.ts` | Common HTTP/security behavior, liveness/readiness, provisioning and activation endpoints |
| `src/admin-auth*.ts` | Staff accounts, invitations, sessions and account-level login throttling |
| `src/assessment-routes.ts` | Rule binding and deterministic assessment evaluation |
| `src/rule-*.ts` | Rule persistence, validation, lifecycle and evaluation helpers |
| `src/product-*.ts` | Product catalogue and associated administration |
| `src/face-scan-*.ts` | Durable provider sessions, receipts, usage and historical measurement reuse |
| `src/report-*.ts` | Report orchestration, evidence/review handling, queue state, traces and usage |
| `src/openrouter-report-client.ts` | Server-only funded model transport and bounded provider attempts |
| `src/codex-proxy-report-client.ts` | Optional local development transport |
| `src/db/schema.ts` / `drizzle/` | Database schema and ordered migration history |

Shared runtime validation is in `packages/config`; request/response and rule contracts are in `packages/contracts`. Keep external contracts separate from provider-specific transport details.

## Setup and commands

Use Bun **1.4.0**. Install workspace dependencies from the repository root:

```sh
bun install --frozen-lockfile
cp .env.example .env
chmod 600 .env
```

Set the private `DATABASE_URL` to a dedicated Scoring PostgreSQL database. The supplied central-service Compose configuration uses PostgreSQL 16. Supply administrator bootstrap/encryption settings if creating a fresh installation; leave external integrations disabled unless deliberately testing them.

From the repository root:

```sh
bun run db:migrate
bun --env-file=../../.env --cwd apps/api dev
```

Alternatively `bun --env-file=.env run dev` starts all workspaces with the root environment loaded before Turbo. When invoking Bun directly from another working directory, resolve `--env-file` against the selected working directory; do not assume the backend loads an unrelated root file automatically.

| Command from repository root | Purpose |
| --- | --- |
| `bun run --cwd apps/api dev` | Watch and run `src/index.ts`; requires environment already loaded |
| `bun run --cwd apps/api build` | Bundle to `apps/api/dist/index.js` for Bun |
| `bun run --cwd apps/api typecheck` | TypeScript verification |
| `bun run --cwd apps/api lint` | TypeScript verification, the same checker for this workspace |
| `bun run --cwd apps/api test` | Bun tests; opt-in database suites stay skipped without their flags |
| `bun run db:generate` | Generate migration SQL after an intentional schema change |
| `bun run db:migrate` | Apply existing migrations using the private root environment |

Default API address: `http://localhost:4100`. Set `PORT` to change the native server; the bundled frontend proxy and Compose mapping assume 4100 and must be adjusted together if changed.

## HTTP and authentication boundaries

The Hono service exposes paths without an `/api` prefix. The browser's gateway strips that prefix.

| Path family | Authentication / role |
| --- | --- |
| `GET /health` | Process liveness; no provider check |
| `GET /ready` | Database/schema readiness, 200 or 503 |
| `/auth/*` | Staff setup/sign-in/invitations/session operations with their own protections |
| `/admin/*` | Authenticated NIQ staff console administration |
| `POST /v1/activate` | One-time deployment activation token; optional recovery request identity |
| Other `/v1/*` integration routes | Deployment bearer credential and capability/rule checks |
| Face-scan callback endpoints | Separate confirmed webhook authentication policy |

The console normally reaches these as `/api/health`, `/api/auth/*` and `/api/admin/*` on its own origin. An Application using the same public gateway must configure a Scoring base URL that includes `/api`, for example `https://scoring.example.com/api`. Direct private API callers can use the origin without that gateway prefix. See [assessment contracts](../../docs/rules/assessment-api.md) for exact integration routes and payloads rather than constructing them from console URLs.

Staff sessions use random opaque tokens in HttpOnly, SameSite=Strict cookies, with Secure enforced in production or by `SECURE_COOKIES=true`. Passwords use Argon2id. Origin checks and both application-level and ingress login throttling are part of the boundary. Deployment credentials are server-side bearer secrets, not staff sessions.

### First administrator and deployment activation

1. Apply migrations and set an independent `ADMIN_BOOTSTRAP_TOKEN` of at least 32 characters.
2. Use the console's first-admin form. Setup closes once an administrator exists.
3. Remove the token and restart the API. It is not an ongoing administration bearer token.
4. Create the client/deployment, configure limits and rule assignment, and issue an activation token.
5. Enter that token only into the intended Application installation's protected connection flow.

`ACTIVATION_TOKEN_ENCRYPTION_KEY` is a stable 64 hex-character key. It protects recoverable unused activation tokens and supports bounded interrupted-exchange recovery. The ongoing deployment credential remains hash-only in Scoring; NIQ Application keeps its own encrypted copy. Losing/rotating encryption keys requires the relevant recovery procedure and cannot be solved by changing an environment label.

For recoverable exchanges, the Application saves `activationRequestId` before sending. Repeating the same token, request UUID and original client reference can recover the same credential for less than 15 minutes, bounded by token expiry and credential validity. An operator must issue the correct customer's token; Application organization IDs are not centrally mapped before the first exchange. See [BYOC connection recovery](../../docs/byoc-connection-recovery.md).

## Runtime configuration

Use the complete commented [environment reference](../../.env.example) alongside `packages/config/src/index.ts`.

### Base service

- `DATABASE_URL`: required; separate from the Application database.
- `NODE_ENV`: development/test/production, default development.
- `PORT`: default 4100; `LOG_LEVEL`: default info.
- `CORS_ALLOWED_ORIGINS`: comma-separated exact browser origins.
- `SECURE_COOKIES`: HTTPS development support; production forces secure cookies.
- `DEPLOYMENT_REGION`: metadata describing this deployment, not a data-migration mechanism.
- `SCORING_PLATFORM_ENABLED`: global switch for scoring and related enabled workflows.
- `REPORT_DIAGNOSTICS_ENABLED`: explicit diagnostics opt-in, default false, independent of runtime mode.

### Report provider

`REPORT_AI_PROVIDER=openrouter`, `REPORT_AI_PROVIDER_ENABLED=true` and a private `OPENROUTER_API_KEY` enable funded model generation. Missing keys fail startup validation when this provider is enabled.

Manager stages use `openai/gpt-6-luna-pro`; all other stages use `openai/gpt-6-luna`. These assignments are implemented by `report-model-routing.ts` and the transport adapter, not editable free-text model names supplied by a client. OpenRouter requests enforce Azure-only routing, no provider fallback, no data collection, zero retention and strict structured outputs.

The local Codex transport requires `REPORT_AI_PROVIDER=codex_proxy`, development mode, a loopback HTTP origin and a private shared token. Both local model settings accept `gpt-6-luna`. It is optional and is not required for a deployed OpenRouter installation.

Model output ceilings, bounded retries and aggregate call budgets are covered by [report output limits](../../docs/report-output-limits.md). Some attempts are billable even if their output is rejected or incomplete; inspect retained provider usage rather than inferring spend from successful report count.

### Face-scan integration

`FACE_SCAN_PROVIDER=stub` and `FACE_SCAN_ENABLED=false` avoid live dispatch by default. Live CarePlix wiring requires the provider selection, explicit enablement/contract confirmation, API base/key/secret, stable `CAREPLIX_ACCOUNT_REFERENCE` and independent `FACE_SCAN_ENCRYPTION_KEY`. Webhook bearer confirmation uses its own secret and flag. Never place these settings in `VITE_*` variables.

Configure retention/dispatch settings through the validated `FACE_SCAN_RETENTION_HOURS` and `FACE_SCAN_MIN_DISPATCH_INTERVAL_MS` values. See [CarePlix operations](../../docs/careplix-implementation.md) before enabling or rotating retained provider data keys.

## Workflow persistence and recovery

### Rule evaluation

An assessment binds once to a concrete rule version and checksum. Default changes affect new bindings. Historical assessments can continue using their bound retired version. Final assessment rules must pass the normal validation/approval lifecycle; legacy draft scoring is separately gated and never enabled in production.

Idempotency fingerprints protect repeated scoring submissions. Synchronous `SCORING` reservations have 120-second leases and attempt fencing, allowing a matching retry to recover an abandoned owner without taking a second allowance slot. An obsolete worker cannot overwrite the replacement owner's completion. This is retry-on-request recovery, not a background retry scheduler.

### AI report content

The API records durable report jobs, generation attempts, usage and restricted traces. A background tick runs every 5 seconds with in-process overlap protection; database ownership/fencing coordinates instances. Responses must remain supported by the assessment and pinned guidance. Bounded review failures can use deterministic matched-rule text without another paid call, while retaining the concerns privately. Missing/conflicting source rules and storage/configuration failures still have explicit error paths.

The Application retrieves/persists content and generates the saved PDF. This Scoring API does not write the Application's upload directory or turn a failed content job into a downloadable PDF by itself.

### Face-scan workflow

Provider workflow state and receipts survive restarts. A background tick handles durable face-scan work when configured. Pending paid-provider scans are **not** reclaimed using deterministic-scoring leases, because an ambiguous dispatch may already have reached the provider. Do not reset/resubmit them to work around a network error without following the provider recovery policy.

Expired private report traces are hidden and pruned in bounded batches at startup/hourly. This is separate from customer assessment/PDF retention. Do not apply broad record deletion as an operational cleanup shortcut.

## Database migrations and testing

Drizzle schema: `src/db/schema.ts`. Migration SQL/journal: `drizzle/`. Review generated SQL, defaults, indexes and backfill behavior before committing a migration. Do not edit migration history already applied to retained environments.

Unit and mocked transport tests run with `bun run --cwd apps/api test`. Database tests opt in through:

- `RULE_DATABASE_TEST=1`: rule, activation, entitlement and scoring-store scenarios.
- `FACE_SCAN_DATABASE_TEST=1`: durable face-scan/provider workflow scenarios.
- `REPORT_TRACE_DATABASE_TEST=1`: trace persistence scenarios.

These suites use `DATABASE_URL` and may create, alter or delete fixture records. Supply a **separate disposable migrated database**, never a customer or development database containing retained records. Read the selected test's setup before enabling it. For example, after exporting a disposable `DATABASE_URL` into the shell:

```sh
RULE_DATABASE_TEST=1 bun run --cwd apps/api test
```

Do not assume skipped database suites were exercised by a normal green unit-test run. Mocked provider tests do not validate funded account availability, public TLS or delivery of a Sentry email.

## Container deployment and upgrades

The root [Compose configuration](../../docker-compose.yml) builds this Dockerfile and its `migrations` target. The migration container installs workspace dependencies and runs `db:migrate`; the runtime image contains the Bun bundle and runs as a non-root user. PostgreSQL health and successful migrations gate API startup.

Follow the [root deployment guide](../../README.md#container-deployment) for private environment files, persistent volumes and HTTPS ingress, or [the staging OpenRouter runbook](../../docs/staging-openrouter.md) for the development-mode shared-network recipe.

Set `NODE_ENV=production` explicitly in the production environment file. This Compose stack inherits the value from that file; its API Dockerfile does not force production mode. Copying the development example unchanged is not a production configuration.

Before an upgrade:

1. Verify a usable database/configuration backup and preserve encryption keys.
2. Review migrations and compatibility with connected Application versions.
3. Stop old workers where a migration introduces new ownership/fencing semantics.
4. Build/apply migrations/start the new code through the deployment workflow.
5. Verify readiness, staff login and an agreed integration scenario before general access.

Scoring migration `0034_byoc_request_recovery` must precede Application use of activation replay. Backward migration is not automatic; rolling back only the binary may be unsafe after a schema/data change.

## Monitoring and troubleshooting

Optional `SENTRY_DSN`, `SENTRY_ENVIRONMENT` and `SENTRY_RELEASE` configure sanitized error-only API monitoring. Worker/terminal failures are reported without clinical content, credentials or raw prompts. Email recipients and issue/uptime/resource alert rules are configured in Sentry, not through an NIQ email environment variable.

| Symptom | Inspect |
| --- | --- |
| `/ready` returns 503 | Database reachability, intended database and complete migration history |
| Staff login/mutations fail behind HTTPS | Exact origins, secure cookies, forwarded scheme, gateway paths and rate limits |
| Activation rejected | Deployment/token state, expiry, encryption configuration and matching replay identity/window |
| New assessment unavailable | Client/deployment/global enablement, allowance, default/pinned approved rule and binding payload |
| Provider unavailable/payment failure | Selected provider configuration, funded account/model route, sanitized job error and recorded usage |
| PDF absent in Application | Corresponding Application generation/PDF job, saved artifact state and file storage; not just Scoring liveness |

Avoid repeatedly regenerating a report during diagnosis. Preserve the failed run identity/trace and distinguish configuration, source guidance, provider and downstream PDF failures. Never paste credentials, raw health data or report traces into general-purpose logs.

Further reading: [architecture](../../docs/architecture.md), [authentication](../../docs/authentication.md), [monitoring](../../docs/monitoring.md), [report tracing](../../docs/report-agent-tracing.md), [frontend](../admin-web/README.md).

# NIQ Scoring Platform

Independent, centrally governed scoring platform for NIQ. It contains an administration UI, a Hono API, immutable/versioned scoring contracts, entitlement foundations, face-scan workflow boundaries, and an explicitly non-clinical provisional engine.

> `NIQ-DRAFT-2026-09` is for development and integration only. It is not clinically validated, approved, or suitable for patient-care decisions.

## Workspace

```text
apps/admin-web          React + TypeScript + Vite NIQ administration console
apps/api                Hono API and PostgreSQL/Drizzle schema
packages/contracts      Versioned external contracts and validation
packages/config         Runtime configuration validation
packages/entitlements   Pure entitlement decision logic
packages/scoring-engine Deterministic provisional scoring engine
docs                    Architecture, compliance and operating notes
```

## Local development

Prerequisites: Bun and a locally available PostgreSQL instance.

```bash
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

Set `DATABASE_URL` and the required secrets in the private `.env` file before migrating. The commented [`.env.example`](.env.example) is the canonical reference for environment variables, defaults, and security constraints. Client/deployment identities and credentials are records managed by the scoring provisioning workflow, not environment variables.

For Docker Compose, copy `.env.example` to the private `.env` file, set a unique `NIQ_SCORING_POSTGRES_PASSWORD` (a 64-character hex value works in the database URL), and set a random `ADMIN_BOOTSTRAP_TOKEN` before first-admin setup. Compose requires the private file and password, keeps PostgreSQL off host ports, and binds the admin console to localhost. Remove the bootstrap token after setup. If a PostgreSQL volume already exists, changing the environment password does not rotate its database password; rotate the role password in that database before restarting with a new value.

```bash
docker compose up --build
```

Use `bun run db:generate` only after intentionally changing the Drizzle schema.

API: `http://localhost:4100`; administration UI: `http://localhost:4173`.

The draft calculation endpoint is fail-closed. To exercise it locally, set `ENABLE_PROVISIONAL_SCORING=true`; `NODE_ENV=production` always disables it.

The console is for NIQ staff only. Set an independent random `ADMIN_BOOTSTRAP_TOKEN`, open the console, and use the one-time setup form to create the first administrator. Setup closes once an administrator exists. Remove the setup token afterward; subsequent access uses individual email/password accounts and server-side sessions. The setup token no longer authorizes administration API requests. See [Administrator accounts](docs/authentication.md) for setup and invitation instructions.

No public client signup is provided. NIQ administrators create clients and deployments, then issue short-lived, one-time activation tokens. Activation returns the deployment credential exactly once; only hashes of high-entropy tokens are stored.

## Assessment and face-scan workflow

An assessment starts with an opaque reference. Scoring resolves the deployment's explicitly selected default rule or pinned rule once and saves the concrete rule version and checksum. Later default or deployment assignment changes affect new assessments only. A retired version remains available to assessments already bound to it, while retirement prevents new bindings.

A face scan for a bound assessment uses that saved version's face-scan mapping, even after retirement or assignment changes. If the mapping is missing or invalid, Scoring rejects the scan before creating a session or reserving usage. Standalone scans can have no mapping and return no face-scan points. See [assessment API](docs/rules/assessment-api.md), [final assessment integration](docs/rules/final-assessment-integration.md), and [CarePlix operations](docs/careplix-implementation.md).

The final assessment profile (`formatVersion: 2`) requires confirmed rules and normal approval before clinical use. The older flexible rule format remains in the code for compatibility; it is not the intended NIQ final assessment flow. Face-scan capture remains disabled by default. Vendor contract confirmation, credentials, staging validation, and operational checks are still required before enabling live capture.

Entity primary and foreign keys are application-generated canonical ULIDs. API
contracts accept uppercase Crockford ULIDs only. Credentials, session secrets,
provider references, request IDs and idempotency keys remain separate opaque values.

## Verification

```bash
bun run typecheck
bun run test
bun run build
```

See [architecture](docs/architecture.md) and [compliance boundaries](docs/compliance.md) before extending the platform.

# NIQ Scoring Platform

Independent, centrally governed scoring platform for NIQ. It contains an administration UI, a Hono API, immutable/versioned scoring contracts, entitlement foundations, face-scan workflow boundaries, and an explicitly non-clinical provisional engine.

> `NIQ-DRAFT-2026-09` is for development and integration only. It is not clinically validated, approved, or suitable for patient-care decisions.

## Workspace

```text
apps/admin-web          React + TypeScript + Vite status console
apps/api                Hono API and PostgreSQL/Drizzle schema
packages/contracts      Versioned external contracts and validation
packages/config         Runtime configuration validation
packages/entitlements   Pure entitlement decision logic
packages/scoring-engine Deterministic provisional scoring engine
docs                    Architecture, compliance and operating notes
```

## Local development

Prerequisites: Bun and Docker.

```bash
cp .env.example .env
docker compose up -d postgres
bun install
bun run db:migrate
bun run dev
```

Use `bun run db:generate` only after intentionally changing the Drizzle schema.

API: `http://localhost:4100`; administration UI: `http://localhost:4173`.

The draft calculation endpoint is fail-closed. To exercise it locally, set `ENABLE_PROVISIONAL_SCORING=true`; `NODE_ENV=production` always disables it.

No public customer signup is provided. NIQ administrators create organizations and deployments, then issue one-time activation credentials. Raw credentials must never be stored.

Entity primary and foreign keys are application-generated canonical ULIDs. API
contracts accept uppercase Crockford ULIDs only. Credentials, session secrets,
provider references, request IDs and idempotency keys remain separate opaque values.

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

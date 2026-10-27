# NIQ Scoring

NIQ Scoring is the central service that governs nutritional assessment rules, customer access, scoring, treatment-related guidance and AI-assisted report content for NIQ Application installations.

NIQ staff use the administration console to manage clients, deployments, rule versions, product mappings and usage. NIQ Application calls the backend with a deployment credential. Clinicians and hospital administrators use NIQ Application, not this staff console.

## System responsibilities

| Component | Responsibility |
| --- | --- |
| Administration frontend | Staff accounts, clients, deployments, rule management, products and operational views |
| Scoring API | Authenticated deployment access, entitlements, rule binding, calculations, face-scan integration and report-content generation |
| Scoring PostgreSQL | Versioned rules, deployment configuration, credentials/hashes, usage, workflow state, audit records and restricted report diagnostics |
| NIQ Application, a separate repository | Patient and assessment workflows, clinical approval, report layout, PDF generation, uploads and downloads |

For Ubuntu BYOC installations, NIQ Application and its database/files run in the customer's cloud. **This Scoring service remains hosted by NIQ.** Selecting `CLIENT_CLOUD` in a deployment record describes the customer installation; it does not install that server.

### Assessment and reporting flow

1. NIQ staff provision a client and deployment, select a rule policy and issue an activation token.
2. The Application backend exchanges the token for a deployment credential and stores that credential encrypted on its own server.
3. A new assessment binds to a concrete rule version and checksum. Following a different default later does not rewrite that assessment's rule evidence.
4. Scoring evaluates the supplied assessment and applies deployment permissions and usage limits. A bound, retired version remains available to its historical assessments; retirement blocks new bindings.
5. After the Application's clinical workflow requests report content, Scoring runs evidence-based planning, writing and review stages, retaining bounded workflow/usage records.
6. The Application renders the returned content and saves the PDF against the assessment. Scoring does not host the clinical application's PDF download interface.

The confirmed assessment profile uses `formatVersion: 2`. Clinical rule approval and activation are explicit lifecycle operations. The historical `NIQ-DRAFT-2026-09` calculation engine is a development-only compatibility tool, is disabled by default and cannot be enabled in production. It must not be used for patient-care decisions.

## Repository layout

```text
apps/admin-web/          React 19, TypeScript and Vite staff console
apps/api/                Bun/Hono API, PostgreSQL stores and Drizzle migrations
packages/contracts/      External contracts, validation and rule definitions
packages/config/         Runtime environment validation
packages/entitlements/   Pure capability and allowance decisions
packages/scoring-engine/ Deterministic rule evaluation and legacy draft engine
packages/monitoring/     Shared safe monitoring event handling
ops/                    Resource monitor and systemd templates
deploy/                 Private-environment deployment templates
docs/                   Architecture, integration and operations runbooks
```

Component guides:

- [Administration frontend](apps/admin-web/README.md)
- [Backend API](apps/api/README.md)

## Development setup

### Prerequisites

- Bun **1.4.0**, matching `packageManager` and container images.
- PostgreSQL reachable from the backend. The supplied central-service Compose stack uses PostgreSQL **16**.
- Git; Docker Engine and Compose v2 if using the container workflow.
- A separate Scoring database. Do not point this repository at the NIQ Application database.

From the repository root:

```sh
cp .env.example .env
chmod 600 .env
bun install --frozen-lockfile
```

Edit the private `.env` before starting anything:

- Set `DATABASE_URL` to the intended Scoring database.
- Generate an independent `ADMIN_BOOTSTRAP_TOKEN` of at least 32 characters for first-admin setup.
- Generate `ACTIVATION_TOKEN_ENCRYPTION_KEY` as 32 random bytes encoded as 64 hex characters for deployment-token management.
- Keep paid integrations disabled unless you intend to use their funded credentials.

Generate each secret independently with `openssl rand -hex 32`. Never reuse a database password as an activation, webhook or encryption key.

```sh
bun run db:migrate
bun --env-file=.env run dev
```

The explicit environment-file option loads backend settings before Turbo starts the workspace processes. Vite also reads the repository-root environment file through its configured `envDir`.

| Local service | Address |
| --- | --- |
| Staff console | `http://localhost:4173` |
| Backend API | `http://localhost:4100` |
| API liveness | `http://localhost:4100/health` |
| API database/schema readiness | `http://localhost:4100/ready` |

The browser calls same-origin `/api/*`. The Vite development proxy removes `/api` before forwarding to port 4100. Do not expose a database password or provider key through frontend variables.

### First NIQ staff administrator

On a fresh database, open the console and use the one-time setup form with `ADMIN_BOOTSTRAP_TOKEN`, name, email and password. Then sign in normally. Remove the bootstrap token from the protected environment and restart the backend after creating the account. It cannot authenticate ordinary administration requests.

Additional staff accounts use one-time invitations generated in **Users**. Invitation links must be shared privately; automatic invitation email is not provided by this workflow. See [authentication](docs/authentication.md). Hospital administrators are created in NIQ Application, including its separate protected BYOC setup flow.

## Configuration

[`.env.example`](.env.example) lists runtime settings and constraints. Configuration is validated in `packages/config/src/index.ts`; deployment-specific secrets belong in private environment files, not source or browser bundles.

| Group | Important settings and behavior |
| --- | --- |
| Runtime/database | `NODE_ENV`, `PORT` (4100), `DATABASE_URL`, `LOG_LEVEL`, `DEPLOYMENT_REGION` |
| Browser access | `CORS_ALLOWED_ORIGINS` contains exact origins; `SECURE_COOKIES=true` for HTTPS development installations; production cookies are secure automatically |
| First-admin/token management | `ADMIN_BOOTSTRAP_TOKEN`, stable `ACTIVATION_TOKEN_ENCRYPTION_KEY` |
| Service switch | `SCORING_PLATFORM_ENABLED=false` blocks new scoring globally |
| AI report generation | `REPORT_AI_PROVIDER`, `REPORT_AI_PROVIDER_ENABLED`, server-only `OPENROUTER_API_KEY` |
| Diagnostics visibility | `REPORT_DIAGNOSTICS_ENABLED`, default false, independent of `NODE_ENV` |
| Face scan | `FACE_SCAN_ENABLED`, `FACE_SCAN_PROVIDER`, contract confirmation, CarePlix credentials/account reference, separate encryption and webhook keys |
| Error monitoring | Server `SENTRY_*` and browser `VITE_SENTRY_*`; both optional |

`REPORT_DIAGNOSTICS_ENABLED=true` enables staff AI usage/agent-trace interfaces and the **Report AI** rule editor section, subject to existing authentication. It is not a provider enablement switch, and hiding it does not stop automatic report generation or private workflow recording. Keep it false on client-visible deployments.

### Model routing

OpenRouter is the deployable provider. Its adapter assigns:

- Manager stages: `openai/gpt-6-luna-pro`.
- Other report stages: `openai/gpt-6-luna`.

The OpenRouter adapter requires Azure-only routing, no provider fallback, no data collection, zero data retention and structured responses. Model availability and account credit must satisfy those requirements. Do not silently relax them to route a request elsewhere.

The optional Codex proxy is restricted to a local HTTP origin in `NODE_ENV=development`; it is not a BYOC/server dependency. `CODEX_PROXY_MANAGER_MODEL` and `CODEX_PROXY_WORKER_MODEL` both accept `gpt-6-luna`. Provider selection does not replace the report orchestration. See [output limits](docs/report-output-limits.md), [report AI](docs/rules/report-ai.md) and [staging OpenRouter](docs/staging-openrouter.md).

A bounded AI review failure may publish a deterministic presentation of the same pinned, matched rules. It does not accept rejected AI text. Missing or conflicting source guidance and infrastructure failures can still prevent completion.

## Build and verification

Run from the repository root:

```sh
bun run typecheck
bun run lint
bun run test
bun run build
```

Turbo builds the workspace packages in dependency order. The API bundle is written to `apps/api/dist`; the static console to `apps/admin-web/dist`.

Database integration tests are opt-in and require **disposable, migrated databases**. Browser tests require Playwright Chromium. See the component guides for isolated commands and test flags. Never use a retained customer database for fixture tests. Ordinary unit tests do not establish live OpenRouter, CarePlix, DNS or TLS connectivity.

For an intentional schema change:

```sh
bun run db:generate
# Review the generated SQL and migration journal before applying.
bun run db:migrate
```

Commit migration history with schema changes. Pulling source alone does not apply migrations or transfer rules, products, patients, provider credentials or database contents.

## Container deployment

The base Compose stack supplies PostgreSQL, a migration job, the API and an nginx-served console. The API waits for healthy PostgreSQL and successful migrations. PostgreSQL has no published host port; API 4100 and console 4173 bind to host loopback.

1. Prepare a private environment file from `.env.example`. For production, explicitly set `NODE_ENV=production`; the example defaults to development and Compose does not override it. Set a unique hex `NIQ_SCORING_POSTGRES_PASSWORD`, the required bootstrap/encryption settings and exact external console origin. Development-mode staging is a deliberate separate recipe, not the production default.
2. For the default local Compose configuration, store it as the protected repository-root `.env` and run:

   ```sh
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=100 migrate api
   ```

3. Put the loopback console gateway behind an HTTPS reverse proxy. Preserve cookie/origin handling, prevent public direct access to API/database ports and retain login rate limiting.
4. Verify `/api/health` and `/api/ready` through the public gateway, create the first staff administrator and remove the bootstrap secret.
5. Provision intended rules, product mappings and customer deployments through the console. A fresh database does not inherit workstation rules.

For an external private environment file, use the same file for Compose substitution and `env_file` selection:

```sh
NIQ_SCORING_ENV_FILE=/etc/niq/scoring.env \
  docker compose --env-file /etc/niq/scoring.env up -d --build
```

The development-mode server recipe uses the additional `compose.staging.yaml`, sets OpenRouter explicitly and joins the shared network for a co-hosted NIQ Application. Follow [the staging runbook](docs/staging-openrouter.md) rather than combining local and server environment files.

Static Vite values are embedded during frontend build. The supplied admin Dockerfile does not expose Sentry build arguments or copy a private `.env` into its build stage; customize a reviewed build pipeline if browser monitoring is needed in that container. Never copy the full server secret file into a frontend build.

### Upgrades, persistence and recovery

- Back up PostgreSQL and required encryption/configuration material before migrations. Keep independent copies of encryption keys needed by retained records.
- The named `scoring-postgres` volume retains database state across container recreation. **Do not use `docker compose down -v` on retained data.** Changing an environment password does not rotate the existing database role's password.
- Rebuild after pulling changes, inspect migration completion, then verify readiness and authenticated access. An older binary is not automatically compatible with a migrated schema; restore from a verified backup when a downgrade requires it.
- For BYOC activation/scoring recovery, deploy Scoring migration `0034_byoc_request_recovery` and its code before the Application changes that depend on it. Stop old workers during that upgrade. See [connection recovery](docs/byoc-connection-recovery.md).
- Configure backup scheduling/restore procedures through the deployment's operations runbook. This repository's base Compose file does not schedule backups by itself.

## Operations and security

- `/health` is process liveness; `/ready` checks database/schema prerequisites. Neither proves funded provider availability or successful clinical report generation.
- NIQ staff sessions and deployment bearer credentials are separate authentication boundaries. Tokens and credentials must not enter browser storage, URLs, screenshots or logs.
- Sentry records sanitized technical failures when configured. It does not send patient-facing report notifications or repair failed jobs. Alert recipients and email delivery are configured in Sentry.
- The optional Linux resource monitor checks CPU, memory and disk and can emit Sentry warning/recovery events and cron check-ins. Installing its systemd timer is an explicit operator action.
- Report traces have their own restricted expiry handling; that is distinct from retained clinical records in NIQ Application.

See [monitoring](docs/monitoring.md), [resource monitoring](docs/resource-monitoring.md), [privacy/compliance boundaries](docs/compliance.md) and [architecture](docs/architecture.md).

## Integration reference

- [Controlled client/deployment onboarding](docs/onboarding.md)
- [Organization connection information](docs/organization-info.md)
- [Assessment API and version binding](docs/rules/assessment-api.md)
- [Final assessment integration](docs/rules/final-assessment-integration.md)
- [Rule management API](docs/rules/management-api.md)
- [Rule definition format](docs/rules/definition-format.md)
- [Care plan guidance](docs/rules/care-plan-guidance.md)
- [CarePlix workflow and operations](docs/careplix-implementation.md)

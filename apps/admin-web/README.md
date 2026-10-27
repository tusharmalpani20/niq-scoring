# NIQ Scoring administration frontend

This React application is the NIQ staff console for the central Scoring platform. It manages customer access and clinical configuration used by NIQ Application installations. It is separate from the patient/clinician-facing NIQ Application frontend.

## Features and user boundaries

| Area | Purpose |
| --- | --- |
| Overview | Service usage and customer/deployment summaries |
| Users | NIQ staff accounts, invitations and access state |
| Clients | Customer records and usage |
| Deployments | Hosting/environment metadata, capabilities, allowances, rule assignments and activation tokens |
| Products | Product catalogue, images and mappings used by guidance |
| Rules | Versioned questionnaire/scoring definitions, risk categories, drug classes, report guidance and care-plan rules |
| AI usage / agent traces | Restricted diagnostics when the backend explicitly enables them |

The **Report AI** rule tab and AI usage/trace surfaces follow `REPORT_DIAGNOSTICS_ENABLED`. This is backend configuration and defaults to false, even in development. It is not a `VITE_*` setting. Hidden controls do not replace API authorization.

All console accounts are NIQ staff administrators. Hospital accounts belong to NIQ Application; the Scoring console does not provide public client signup.

## Stack and structure

React 19, TypeScript, Vite 7, React Router, Tailwind CSS, shadcn/ui, React Hook Form and Zod. Source lives in `src/`; shared API contracts come from `packages/contracts`.

- `src/api.ts` provides same-origin JSON requests and consistent error handling.
- `src/monitoring.ts` initializes optional sanitized browser error reporting.
- `src/styles.css` defines semantic theme variables.
- `e2e/` contains Playwright page and integration scenarios.
- `vite.config.ts` loads root environment files and proxies `/api` to the local backend.
- `nginx.conf` serves the built SPA and proxies API traffic in the container.

## Local development

Install dependencies from the repository root using Bun 1.4.0:

```sh
bun install --frozen-lockfile
```

Prepare the private root `.env`, database migrations and backend as described in the [root guide](../../README.md). Run both apps from that root:

```sh
bun --env-file=.env run dev
```

Or start only this frontend after the API is running:

```sh
bun run --cwd apps/admin-web dev
```

The console opens at `http://localhost:4173`; its proxy expects the API at `http://localhost:4100`. If you change the backend port, also adapt the development proxy. The current proxy is not derived from `PORT`.

### Browser/API boundary

Requests go to `/api/auth/*`, `/api/admin/*` and other same-origin API paths as needed. Vite/nginx removes the `/api` prefix before forwarding to Hono. The browser uses HttpOnly session cookies through `credentials: same-origin`; it does not store an administrator API bearer token in local storage.

For static hosting, preserve SPA history fallback and provide an equivalent same-origin API gateway. Serving `dist/` alone without `/api/` routing does not create a working console.

## Configuration

Vite reads the repository-root environment directory. Only `VITE_*` variables are exposed to browser code:

| Variable | Purpose |
| --- | --- |
| `VITE_SENTRY_DSN` | Optional public Sentry ingestion DSN; omitted disables monitoring |
| `VITE_SENTRY_ENVIRONMENT` | Monitoring environment label |
| `VITE_SENTRY_RELEASE` | Release identifier, normally the deployed revision |

These values are compiled into static assets. Restart Vite after changing them in development and rebuild for static deployment. A Sentry auth token is a secret and must never become a browser variable. Neither `OPENROUTER_API_KEY`, database URLs nor CarePlix secrets belong in this frontend's environment.

The API's `CORS_ALLOWED_ORIGINS` must include the actual console origin. HTTPS development deployments need `SECURE_COOKIES=true`; production enables secure cookies automatically. Browser and API must agree on origin/proxy handling for authenticated mutations.

## Accounts and clinical configuration

For a fresh database, the frontend offers protected first-administrator setup. Supply the private `ADMIN_BOOTSTRAP_TOKEN`, administrator name/email and password. Setup creates an account without automatically signing it in. Remove the bootstrap secret from server configuration afterward.

Additional administrators receive a one-time invitation link from **Users**. Sharing that link is manual; this workflow does not automatically email it. Account deactivation invalidates sessions. See [authentication](../../docs/authentication.md) for invitation expiry and session rules.

Rule drafts can be edited; approved/active versions are immutable and changed through duplication/versioning. The active default affects new assessments on deployments that follow the default. Existing assessments keep their pinned version/checksum. Retiring a rule prevents new bindings without rewriting existing evidence.

Deployment activation tokens and API credentials are different. A token is entered into NIQ Application and exchanged by its backend; the resulting credential is not exposed in this console's browser storage. Copy token values only through their intended protected workflow and share them privately.

## Build and checks

From the repository root:

```sh
bun run --cwd apps/admin-web typecheck
bun run --cwd apps/admin-web lint
bun run --cwd apps/admin-web test
bun run --cwd apps/admin-web build
```

The production static output is `apps/admin-web/dist`. Repository-wide `bun run build` also builds backend/shared packages through Turbo.

### Browser tests

Install Chromium once, then run from this directory:

```sh
bunx playwright install chromium
bun run test:browser
bun run test:browser:integration
```

The normal browser configuration starts a dedicated Vite instance on `127.0.0.1:4183` and runs desktop/mobile Chromium scenarios. Integration tests start a synthetic API fixture on `127.0.0.1:4191` and a separate frontend on `127.0.0.1:4184`, with one worker. These configurations do not reuse a running server.

Keep those ports available. Fixture/browser tests are not a substitute for deployment acceptance with actual database, TLS and provider configuration. Do not use real patients or secrets in recorded test traces/screenshots.

## Deployment

The repository's `apps/admin-web/Dockerfile` builds the frontend and serves it with nginx. Root `docker-compose.yml` publishes the gateway on **host loopback port 4173**. nginx forwards `/api/` to the `api:4100` service and falls back to `index.html` for client-side routes. It also applies basic security headers and a source-based login rate limit.

Use the root [deployment guide](../../README.md#container-deployment) and [OpenRouter staging runbook](../../docs/staging-openrouter.md). The external HTTPS reverse proxy/domain configuration belongs to the deployment environment. Do not hard-code a client's hostname in Vite source. For a native development server requiring an additional exact host, set Vite's `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` in that server process environment.

The Dockerfile does not currently take browser Sentry build arguments or copy `.env`. Supply reviewed public build-time values through your build pipeline if needed. Runtime `env_file` settings on the API cannot modify already compiled frontend assets.

The shipped nginx Content Security Policy allows only same-origin connections. Browser Sentry delivery additionally requires an explicit allowlist entry for the configured DSN's ingest endpoint in the effective policy. A built-in DSN alone does not make monitoring work through this container; keep the allowance narrow rather than disabling CSP.

## UI implementation conventions

- Reuse official shadcn/ui primitives rather than custom replacements where a primitive exists.
- Compose page behavior and form bindings around those primitives.
- Keep theme colors in semantic CSS variables in `src/styles.css`; do not hard-code brand colors in page components.
- Use shared contract validation and server error codes consistently. Client-side checks improve feedback; the backend remains the authorization and validation boundary.
- Preserve keyboard access, field labels, responsive layouts and browser refresh/deep-link behavior.

## Related documentation

- [Backend API](../api/README.md)
- [Rule lifecycle and architecture](../../docs/architecture.md)
- [Rule management](../../docs/rules/management-api.md)
- [Monitoring and alert delivery](../../docs/monitoring.md)

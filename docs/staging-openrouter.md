# Development-mode server deployment with OpenRouter

This is a restricted staging installation, not the production rollout. Both APIs
stay in `NODE_ENV=development`. Diagnostic pages are independently controlled by
`REPORT_DIAGNOSTICS_ENABLED`, which defaults to `false` in both server templates.
Production OTP/invitation delivery is deferred.
Keep access restricted to the agreed testers. Use synthetic assessment data.

## Scoring server setup

1. Pull `origin/main` in this repository and `niq-application`.
2. Copy `deploy/staging.env.example` to an absolute private path outside the
   checkout (for example `/etc/niq/scoring-staging.env`). Restrict it to the service
   operator with mode `600`. Fill in the funded `OPENROUTER_API_KEY`, exact scoring
   browser origin, a random hex database password, independent bootstrap secret
   and activation-token encryption key. Generate each secret separately.
3. Create the shared container network once:

   ```sh
   docker network create niq-staging
   ```

   Reuse it if it already exists. Neither database needs a published host port.
4. Start Scoring with both Compose files and the same private env file:

   ```sh
   NIQ_SCORING_ENV_FILE=/etc/niq/scoring-staging.env \
   docker compose --env-file /etc/niq/scoring-staging.env \
     -f docker-compose.yml -f compose.staging.yaml up -d --build
   ```

   The migration container must finish successfully before the API starts. Do not
   use the repository's workstation `.env` on the server. The override explicitly
   selects OpenRouter, enables generation and retains development mode; it does
   not contact a local Codex proxy. Missing OpenRouter credentials stop API startup
   with a clear configuration error instead of silently selecting fallback text.
5. Follow the application repository's `docs/staging-openrouter.md` instructions.
   Its API connects to `http://niq-scoring-api:4100` on `niq-staging`. The browser
   still uses same-origin `/api`; never place provider credentials in browser env.
6. Put the scoring gateway (loopback port `4173`) and application gateway behind
   the server's HTTPS reverse proxy. Configure the actual external origins in
   each private env file. Do not expose the development API/admin ports publicly.

## Existing data and activation

Compose creates new databases unless the corresponding named volumes already
exist. Pulling code does not copy local patients, rules, reports or credentials.
Choose the intended server database/volumes before startup. For a new installation,
set up a named scoring administrator, create/activate the intended rules, provision
an application deployment and activate its connection from the application. Existing
connections require their original database and encryption keys. Never replace keys
on retained encrypted data. Preserve database volumes and back them up; do not run
`docker compose down -v` on retained data.

## Provider verification on the server

No paid model requests are made by the deployment commands alone. Before requesting
a report, verify startup/readiness and that the deployment's active rules are set.
Then test one agreed synthetic assessment only:

- Confirm the job uses OpenRouter and the existing role assignments. Manager,
  reviewer and coverage use `openai/gpt-6.1-sol`; drafting, repairs, summaries and
  highlighting use `openai/gpt-6-luna`.
- These model IDs must be available on the funded account through the configured
  Azure-only route. The adapter also requires strict JSON schema parameters,
  no provider fallback, no data collection and zero data retention. Do not loosen
  these restrictions or silently substitute models to make an unavailable route
  pass. Confirm supported IDs/settings on the server before changing them.
- Inspect retained server-side calls/review decisions and check that the report reaches `READY`
  without unintended fallback. Review retry counts, latency and actual usage/cost.
- Use a normally completed assessment for the automatic PDF check. A legacy
  `html-review` test request intentionally holds PDF export until explicitly requested
  from the diagnostics-enabled report workspace; it is not the normal automatic workflow.
- Confirm the PDF is saved against the intended assessment, is visible after a
  refresh/restart and downloads from both the list and assessment detail.
- Check product images, page breaks, section headers/footers and the downloaded PDF.

OpenRouter live model/route availability, credit, latency and output quality are
not established by local mocked adapter tests. Validate these before wider use.
If a check fails, retain the same job/error evidence; do not regenerate other
assessments or switch provider/security settings without investigating it.

## Environment and secrets

The normal `.env.example` leaves report AI disabled. The staging template enables
OpenRouter but leaves its key empty for private server entry. Never commit the
filled env file, print `docker compose config` with real secrets to shared logs,
or copy credentials into screenshots. Face scans and provisional scoring remain
disabled in this staging recipe. Codex support remains in source for local use;
it is not part of this server deployment. Switching to actual production later
requires the separate production authentication, delivery and operations work.

## Report diagnostics visibility

`REPORT_DIAGNOSTICS_ENABLED=true` enables AI usage and agent-trace UI/API access in
Scoring. Set the same flag independently in the application to enable its clinical
report preview, regeneration and layout workspace. Local private `.env` files use
`true`; client server templates use `false`. An omitted flag also means `false`,
including with `NODE_ENV=development`. It is independent of runtime mode. Restart
the APIs and reload the browser session after changing it. Existing administrator
and clinical permissions still apply. Automatic generation, PDF download routes
and restricted trace retention continue regardless of this visibility flag.

Do not enable it on the client installation just to keep development OTP working.
Those authentication settings continue to follow their own existing settings.

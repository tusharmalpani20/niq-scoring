# Sentry operations monitoring

The API and browser have separate Sentry projects in `factbook`. Configure `SENTRY_DSN` for the API and `VITE_SENTRY_DSN` for the browser in the private root `.env`. Both are optional; unset means disabled. Vite loads the root env but exposes only `VITE_*` values to the browser. Never add API keys or Sentry authentication tokens to a `VITE_*` variable.

Set `SENTRY_ENVIRONMENT` and `VITE_SENTRY_ENVIRONMENT` to the installation label (`development` currently), and release variables to the deployed Git revision. Restart the API and Vite development server after changing env. Rebuild the browser for static deployments. Runtime mode and report diagnostics remain independent of monitoring.

## Data boundaries

This is error-only monitoring. No replay, automatic request/database/AI instrumentation, performance tracing or console log forwarding is installed. SDK collection of users, headers, cookies, bodies, query strings, AI input/output, query values and stack variables is explicitly disabled. A final allowlist reconstructs each outgoing error: generic operation name, severity, environment/release and source filename/line/column. Original error text, user records, routes/URLs, request data, breadcrumbs, contexts and extras are removed before sending. Do not loosen this for debugging clinical content. Technical debugging requiring report text remains in the private diagnostics workspace.

Unhandled errors, React root errors, unexpected API errors, caught background-worker failures and terminal report/PDF failures are covered. Repeated caught failures are limited to one event per operation per minute per API process. Routine validation/authentication failures are not application errors. Sentry cannot resolve failed jobs or regenerate reports by itself.

## Alert routing and verification

Route error issues and operations resource warnings to `factbook999@gmail.com` (the organisation member must have email notifications enabled). Start with immediate new issues and a 30-minute repeated-alert limit. Use independent uptime checks for both public APIs: a stopped server cannot send its own error event. Alerts are separate from the reporting workflow and must not block it.

Use a deliberate generic smoke error, not patient data, to verify ingestion and email routing after deployment. A successful envelope submission does not prove that an email reached the recipient; confirm delivery in the mailbox. No model call is required.

Backups, key recovery and record retention are covered by their operations runbooks. Assessments, reports and valid uploads remain indefinitely; monitoring introduces no clinical-data deletion.

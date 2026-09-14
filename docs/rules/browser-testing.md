# Rule editor browser tests

Run from `apps/admin-web`:

```sh
bunx playwright install chromium
bun run test:browser
```

`@playwright/test` is a development-only dependency. It supplies browser interaction assertions that the existing Bun helper tests cannot perform. The locked Playwright version controls its matching Chromium download; install that browser again after upgrading Playwright. Linux CI may require the browser's documented OS libraries. It does not enter the production browser bundle.

The suite starts its own Vite server on port 4183 and closes it afterward. It refuses to reuse another server on that port. Browser contexts are isolated and every `/api/` request is intercepted with synthetic responses, including authentication. Unknown API calls fail; none fall through to the running backend. No real cookies, client data, clinical approvals or deployment usage are involved.

The desktop and mobile-sized Chromium projects exercise the actual React controls. They are not WebKit/iOS compatibility tests. Traces for failures live in ignored `test-results/`; normal unit tests remain `bun run test`. Frontend typechecking includes the browser tests and configuration.

These tests establish frontend behavior against controlled API outcomes. They do not replace PostgreSQL integration tests or the remaining full-stack primary-flow browser review.

## Browser plus real API

```sh
bun run test:browser:integration
```

This separate configuration starts the real Hono API on loopback port 4191 and the web interface on 4184. No requests are mocked. Authentication, validation, CRUD, audit and lifecycle routes run against disposable memory stores. The opt-in `NIQ_BROWSER_TEST=1` fixture entry point is not imported by the production server and creates no database connection. Its public synthetic login is valid only within that process. Both processes stop when the test run ends.

Desktop and mobile-sized runs cover login, spreadsheet draft creation, saved-state/reopening, unresolved-template approval prevention, duplication independence and confirmed deletion of the disposable drafts. This proves browser/API integration with memory persistence, not PostgreSQL behavior or persistence across server restarts. Keep the opt-in PostgreSQL test results separate when reporting coverage.

A second scenario authors a complete synthetic questionnaire, option scoring, caps, classification, guidance and sample through the UI. It checks the real preview result, rejects a wrong expected score, corrects it, validates and explicitly approves the draft, then activates and retires it. Read-only controls and returned audit actions are checked. The synthetic approved records exist only in that test-server process and disappear when it stops; no source-derived clinical package is approved.

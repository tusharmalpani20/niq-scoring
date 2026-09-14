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

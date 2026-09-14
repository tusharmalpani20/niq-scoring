import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: "**/*.integration.ts", workers: 1,
  use: { baseURL: "http://127.0.0.1:4184", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: [
    { command: "NIQ_BROWSER_TEST=1 bun ../api/src/browser-test-server.ts", url: "http://127.0.0.1:4191/health", reuseExistingServer: false },
    { command: "bunx vite --config vite.browser-test.config.ts", url: "http://127.0.0.1:4184", reuseExistingServer: false },
  ],
});

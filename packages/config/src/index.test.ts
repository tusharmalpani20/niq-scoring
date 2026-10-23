import { expect, test } from "bun:test";
import { parseEnvironment } from "./index";

const base = { DATABASE_URL: "postgres://localhost/unused", NODE_ENV: "development" };
test("enabled OpenRouter requires a nonempty server key before starting workers", () => {
 for (const OPENROUTER_API_KEY of [undefined, "", "   "]) {
  expect(() => parseEnvironment({...base, REPORT_AI_PROVIDER:"openrouter", REPORT_AI_PROVIDER_ENABLED:"true", OPENROUTER_API_KEY})).toThrow("OpenRouter requires an API key");
 }
});
test("staging can prepare OpenRouter disabled and enable it with a privately configured key", () => {
 expect(parseEnvironment({...base, REPORT_AI_PROVIDER:"openrouter"}).REPORT_AI_PROVIDER_ENABLED).toBe(false);
 expect(parseEnvironment({...base, REPORT_AI_PROVIDER:"openrouter",REPORT_AI_PROVIDER_ENABLED:"true",OPENROUTER_API_KEY:"test-server-only-key"}).REPORT_AI_PROVIDER).toBe("openrouter");
});

test("report diagnostics are explicitly enabled and independent of runtime mode", () => {
 for (const NODE_ENV of ["development", "test", "production"]) {
  expect(parseEnvironment({...base,NODE_ENV}).REPORT_DIAGNOSTICS_ENABLED).toBe(false);
  expect(parseEnvironment({...base,NODE_ENV,REPORT_DIAGNOSTICS_ENABLED:"false"}).REPORT_DIAGNOSTICS_ENABLED).toBe(false);
  expect(parseEnvironment({...base,NODE_ENV,REPORT_DIAGNOSTICS_ENABLED:"true"}).REPORT_DIAGNOSTICS_ENABLED).toBe(true);
 }
 expect(()=>parseEnvironment({...base,REPORT_DIAGNOSTICS_ENABLED:"yes"})).toThrow();
});

test("secure cookies can be enabled for HTTPS development without changing runtime mode", () => {
 expect(parseEnvironment(base).SECURE_COOKIES).toBe(false);
 expect(parseEnvironment({...base, SECURE_COOKIES:"true"}).SECURE_COOKIES).toBe(true);
 expect(()=>parseEnvironment({...base,SECURE_COOKIES:"yes"})).toThrow();
});

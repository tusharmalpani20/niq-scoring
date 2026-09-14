import { createApp } from "./app";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { MemoryScoringStore } from "./store";

// Explicit opt-in, loopback only, disposable memory stores. This entry point is
// never imported by the production server and never reads database credentials.
if (process.env.NIQ_BROWSER_TEST !== "1") throw new Error("Browser fixture requires NIQ_BROWSER_TEST=1");
const authStore = new MemoryAdminAuthStore();
authStore.state.users.push({
  id: "01J00000000000000000000001", email: "browser@example.test", displayName: "Synthetic browser QA",
  enabled: true, createdAt: new Date().toISOString(),
  passwordHash: await Bun.password.hash("Synthetic-browser-test-only-123!", { algorithm: "argon2id" }),
});
const app = createApp({ store: new MemoryScoringStore(), authStore,
  allowedOrigins: ["http://127.0.0.1:4184"], region: "test", runtimeEnvironment: "test", provisionalScoringRequested: false });
Bun.serve({ hostname: "127.0.0.1", port: 4191, fetch: app.fetch });

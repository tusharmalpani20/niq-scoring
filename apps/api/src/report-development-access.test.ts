import { expect, test } from "bun:test";
import { createApp } from "./app";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { MemoryScoringStore } from "./store";
import { createEntityId } from "./lib/id";

for (const runtimeEnvironment of ["development", "test", "production"] as const) {
  for (const reportDiagnosticsEnabled of [undefined, false, true]) {
  test(`AI diagnostics flag ${reportDiagnosticsEnabled} controls access in ${runtimeEnvironment}`, async () => {
    const authStore = new MemoryAdminAuthStore();
    const userId = createEntityId(), token = "development-access-test-session";
    authStore.state.users.push({id:userId,email:"admin@example.test",displayName:"Admin",passwordHash:"unused",enabled:true,createdAt:"2026-01-01T00:00:00Z"});
    authStore.state.sessions.push({userId,tokenHash:new Bun.CryptoHasher("sha256").update(token).digest("hex"),expiresAt:"2099-01-01T00:00:00Z"});
    const app = createApp({store:new MemoryScoringStore(),authStore,runtimeEnvironment,...(reportDiagnosticsEnabled === undefined ? {} : {reportDiagnosticsEnabled}),allowedOrigins:[],region:"test",provisionalScoringRequested:false});
    const headers = {cookie:`niq_scoring_session=${token}`};
    const status = await (await app.request("/auth/status")).json();
    expect(status.developmentToolsEnabled).toBe(reportDiagnosticsEnabled === true);
    expect((await app.request("/admin/report-ai/runs",{headers})).status).toBe(reportDiagnosticsEnabled === true ? 200 : 404);
    expect((await app.request("/admin/report-ai/runs/invalid/trace",{headers})).status).toBe(reportDiagnosticsEnabled === true ? 400 : 404);
    expect((await app.request("/admin/report-ai/models",{headers})).status).toBe(200);
  });
  }
}

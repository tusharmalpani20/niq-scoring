import { parseEnvironment } from "@niq-scoring/config";
import postgres from "postgres";
import { createApp } from "./app";
import { PostgresScoringStore } from "./postgres-store";
import { createFaceScanAdapter } from "./face-scan";

const environment = parseEnvironment(Bun.env);
const database = postgres(environment.DATABASE_URL, { max: 2, idle_timeout: 10 });
const app = createApp({
  store: new PostgresScoringStore(database),
  ...(environment.ADMIN_BOOTSTRAP_TOKEN ? { adminBootstrapToken: environment.ADMIN_BOOTSTRAP_TOKEN } : {}),
  allowedOrigins: environment.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()),
  region: environment.DEPLOYMENT_REGION,
  runtimeEnvironment: environment.NODE_ENV,
  provisionalScoringRequested: environment.ENABLE_PROVISIONAL_SCORING,
  platformEnabled: environment.SCORING_PLATFORM_ENABLED,
  faceScanAdapter: createFaceScanAdapter(environment.FACE_SCAN_PROVIDER),
  readinessCheck: async () => {
    try {
      const [result] = await database<{ schemaReady: boolean }[]>`
        select to_regclass('public.scoring_rule_versions') is not null
          and to_regclass('public.audit_events') is not null as "schemaReady"
      `;
      return result?.schemaReady === true;
    } catch {
      return false;
    }
  },
});

Bun.serve({
  port: environment.PORT,
  fetch: app.fetch,
});

console.info(JSON.stringify({ event: "service_started", service: "niq-scoring-api", port: environment.PORT, region: environment.DEPLOYMENT_REGION }));

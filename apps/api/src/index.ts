import { parseEnvironment } from "@niq-scoring/config";
import postgres from "postgres";
import { createApp } from "./app";

const environment = parseEnvironment(Bun.env);
const database = postgres(environment.DATABASE_URL, { max: 2, idle_timeout: 10 });
const app = createApp({
  apiKey: environment.DEV_API_KEY,
  allowedOrigins: environment.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()),
  region: environment.DEPLOYMENT_REGION,
  runtimeEnvironment: environment.NODE_ENV,
  provisionalScoringRequested: environment.ENABLE_PROVISIONAL_SCORING,
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

# Organization information integration

`GET /v1/integrations/organization-info` returns the persisted client configuration and the specific deployment associated with an activation-issued service credential. NIQ Application should call this from its backend after exchanging an activation token at `POST /v1/activate`.

## Request

```sh
curl "$NIQ_SCORING_URL/v1/integrations/organization-info" \
  -H "Authorization: Bearer $NIQ_SERVICE_CREDENTIAL"
```

The credential format is `niq_dep_<key-prefix>.<secret>`. Use the complete credential returned by activation, not the `niq_` activation token or an administrator session. No organization/deployment ID or other query parameters are accepted. Identity is resolved on the server and rechecked when reading the snapshot, including credential expiry/revocation and client/deployment status. The response uses `Cache-Control: no-store`.

## Success contract (200)

The shared exports `organizationInfoSchema` and `OrganizationInfo` in `@niq-scoring/contracts` define the authoritative contract. All fields below are required except `limits.users`, which is deliberately absent because it is unsupported.

```json
{
  "organization": {
    "id": "01K4ZJ9QJ7F3TWHDW1B1T6A4YV",
    "name": "Example Health Network",
    "status": "ACTIVE"
  },
  "deployment": {
    "id": "01K4ZJ9QJ7F3TWHDW1B1T6A4YW",
    "mode": "NIQ_HOSTED",
    "environment": "production",
    "status": "ACTIVE"
  },
  "services": {
    "scoring": { "enabled": true },
    "faceScan": { "enabled": false }
  },
  "limits": {
    "scoresPerMonth": 10000,
    "faceScansPerMonth": null
  },
  "usage": {
    "period": "2026-09",
    "scores": 12,
    "faceScans": 0
  },
  "updatedAt": "2026-09-14T10:00:00.000Z",
  "unavailableFields": ["limits.users"]
}
```

- Organization maps to the existing `clients` record. Status enums are `ACTIVE | DISABLED`; disabled clients or deployments receive an error instead of this response.
- Deployment `mode` maps to persisted `hosting_type`: `NIQ_HOSTED | CLIENT_CLOUD | ON_PREMISES`. The last value supports historical records, even though new creation no longer offers it. `environment` preserves the existing stored domain value.
- Service switches and monthly limits come from current entitlement records (`effective_until IS NULL`), following the existing quota convention. Both entitlement records and the hosting mode must exist; missing configuration returns 409. No missing service defaults to enabled and no missing entitlement defaults to unlimited.
- A monthly limit of `null` explicitly means unlimited. Zero means zero allowance. A disabled service may retain its configured limit, including unlimited; the service switch still controls access.
- Service switches describe entitlement configuration. They do not promise rule-version approval, platform availability, or CarePlix readiness; execution endpoints continue to enforce those requirements.
- Usage is scoped to this deployment, not summed across all deployments belonging to the client. `period` is the current UTC calendar month (`YYYY-MM`), with inclusive month start and exclusive next-month start. Counts use persisted usage events with `billable=true` or `outcome=PENDING`, matching quota accounting. Thus in-progress reservations are included, and ordinary failed/rejected nonbillable events are excluded. A successful retry is counted once under existing idempotency handling. No matching records means zero.
- `updatedAt` is the latest persisted modification timestamp among the client, deployment and current entitlements. It is not a usage timestamp, response-generation time or cache validator for usage. The schema permits explicit null when no timestamp is available; production PostgreSQL supplies one, while the in-memory test store has no persisted timestamps.
- **NIQ Scoring does not store an application user limit.** `limits.users` is omitted and explicitly listed in `unavailableFields`. NIQ Application must not interpret this omission as unlimited. Adding authoritative user limits requires a separate configuration/model change.
- Credentials have expiry and revocation, but no independent enabled flag. Client/deployment disabling blocks effective access even with an otherwise valid credential.

The response is constructed from an explicit allowlist and validated before transmission. It contains no activation token, service credential, key prefix, hashes or encrypted secrets. Successful snapshot reads write `ORGANIZATION_INFO_READ` to the existing audit log, with credential ID as actor and deployment ID as resource; secret material is not recorded.

## Errors

Errors follow the existing JSON envelope and the exported `organizationInfoErrorSchema`:

```json
{ "error": "UNAUTHORIZED" }
```

| HTTP | `error` | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Query parameters were supplied. |
| 401 | `UNAUTHORIZED` | Missing/malformed/invalid credential, expired or revoked credential, or invalid credential ownership. |
| 403 | `CLIENT_DISABLED` | The authenticated client is disabled. |
| 403 | `DEPLOYMENT_DISABLED` | The authenticated deployment is disabled. |
| 409 | `CONFIGURATION_INCOMPLETE` | Hosting or a required current entitlement is missing. |
| 500 | `INTERNAL_ERROR` | Unexpected failure, including database/audit failure or an invalid stored response. No internal details are exposed. |

NIQ Application should stop treating its cached configuration as authorization after 401/403. Handle missing configuration and unavailable fields explicitly; do not substitute enabled/unlimited defaults. NIQ Scoring remains the enforcement authority on each scoring or face-scan operation. This endpoint does not itself reserve or consume usage.

## Verification and database changes

No migration or new package is required. Existing client, deployment, credential, entitlement, usage and audit tables supply this feature.

- API tests use credentials obtained through the real activation route, verify two-client isolation, reject caller-selected identities, and cover credential status, disabled entities, missing configuration, response schema, limit semantics, monthly usage and secret exclusion.
- The PostgreSQL regression test uses transaction rollback and covers identity binding, month boundaries, usage outcomes, configuration, status, expiry, revocation and audit contents.

```sh
bun run typecheck
bun run test
# From apps/api with the local test database configured:
RULE_DATABASE_TEST=1 bun --env-file=../../.env test src/postgres-organization-info.test.ts
```

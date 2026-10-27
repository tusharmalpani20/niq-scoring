# BYOC connection and scoring recovery

NIQ Application runs in the customer's cloud. This Scoring API remains on NIQ infrastructure.

## Interrupted activation

`POST /v1/activate` accepts an optional `activationRequestId` UUID alongside the activation token. Application must durably save that UUID against the organization and token hash **before** sending the request. Retrying the same token must reuse the UUID. Do not log either token or returned credential.

The first exchange consumes the token and creates one credential. Application includes its organization ULID as `clientReference`; the first exchange binds it and replay must match it exactly. Legacy callers may omit the reference. This does not prevalidate the initial organization: an operator must issue the correct deployment token because Application organization IDs are not centrally mapped.

An identical exchange can recover that same credential for less than 15 minutes after the first exchange, and never beyond the activation token's original expiry. Replaying with a different UUID, a revoked/expired credential, or a different activation encryption key fails closed. Existing callers without the UUID retain one-use behavior.

The credential is derived using a domain-separated HMAC and remains hash-only in the Scoring database. It is not stored as a recoverable API secret. Rotating `ACTIVATION_TOKEN_ENCRYPTION_KEY` invalidates recovery of unfinished exchanges, but does not invalidate already stored Application credentials. After the recovery window expires, an operator must issue a fresh activation token. Activation is not silently retried with a new UUID.

Deploy Scoring migration `0034_byoc_request_recovery` and its API code before enabling UUID recovery in Application. Readiness requires the migration's columns. Stop old API workers during the upgrade rather than leaving unfenced old binaries running beside the new version.

## Interrupted scoring

Only synchronous `SCORING` usage reservations receive a 120-second lease and an attempt token. Assessment calculation is deterministic and completes before saving the response; it makes no OpenRouter or CarePlix request.

An identical request whose owner crashed can reclaim its expired reservation. It retains the existing result reference and does not reserve an additional quota slot. The same fingerprint, authorization, entitlement and rule checks still apply. Concurrent reclaims grant one owner. Every scoring completion/failure supplies the attempt token so an obsolete worker cannot overwrite the new owner's result.

Completed requests still return the saved result. This is retry-on-request recovery, not an autonomous background retry queue: Application must repeat the same request and idempotency key after connectivity returns.

Pending `FACE_SCAN` requests are deliberately not reclaimed by this mechanism, because they may have reached a paid provider already. The durable face-scan workflow owns their recovery. The separate AI report queue and its existing recovery behavior are unchanged.

## Local verification

- Route regression reproduces interrupted activation and checks key rotation, UUID mismatch, revocation and the replay deadline.
- PostgreSQL concurrent activation requests produce one credential and identical responses.
- PostgreSQL scoring tests cover legacy abandoned reservations, quota preservation, single-owner concurrent takeover, stale completion/failure fencing, disabled clients and unchanged face-scan reservations.
- Tests use temporary databases and synthetic fixtures. No paid provider calls are needed.

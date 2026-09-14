# Compliance and security boundaries

This scaffold supports compliance engineering; it is not a certification or legal determination.

- Use TLS for every external and service-to-service connection.
- Store deployment credential hashes only. Store unused activation tokens encrypted with a separate AES-256-GCM key so administrators can copy them again until used or expired; clear the ciphertext when consumed. Exchange activation tokens server-to-server for a revocable deployment credential. The scoring API and application activation screen implement this exchange; the application stores the credential encrypted on its backend.
- Never log raw credentials, patient identifiers, input payloads or face images.
- Use pseudonymous assessment references and data minimization.
- Partition every business record by client; enforce that boundary in repositories and tests, not only in the UI.
- Record authentication, entitlement, rule publication, assignment, scoring, export and administrative events in an append-only audit stream.
- Treat audit records separately from redacted operational logs.
- Apply idempotency to calculations and face-scan callbacks so retries do not double count usage.
- Perform idempotency resolution, entitlement/quota checking and usage reservation atomically in one database transaction; concurrent requests must not exceed limits.
- Return activation and deployment credentials once, prevent response caching, persist only hashes, and revoke per deployment.
- Use the bootstrap admin token only for first-account setup, then remove it. Named NIQ accounts, cookie sessions and account-management audit attribution are implemented; MFA/SSO remains a production prerequisite.
- Count quota periods in UTC and retain the immutable scoring version with each result.
- Encrypt databases, backups and object storage; rotate keys and credentials.
- Maintain retention, deletion, legal-hold, incident response, access-review and vendor-governance procedures.
- Keep production patient data out of development and testing.
- Complete clinical validation and India/US/EU medical-device classification before activating clinical scoring.
- Provisional scoring is disabled by default and can run only when explicitly enabled in development or test. Production rejects it even if the flag is set.
- Review face-scan vendors, hosting regions, contracts, subprocessors and breach terms before sending real data.

For India operations, retain required security logs and operate a CERT-In response process. Future US/EU deployments require HIPAA/GDPR contracts and region/transfer decisions before data flows are enabled.

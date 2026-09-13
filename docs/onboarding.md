# Controlled onboarding

There is no public signup.

1. An NIQ administrator creates a customer, organization and its first deployment.
2. NIQ links the deployment to its allowed organizations.
3. NIQ assigns rule policy and nullable monthly limits (`null` means unlimited).
4. NIQ generates a short-lived, one-time activation secret.
5. The customer enters it into its application deployment.
6. The scoring platform exchanges it once for a deployment credential; only hashes and safe metadata are retained.
7. Credentials can be revoked per deployment without affecting other installations.

One central Apollo production installation therefore uses one production deployment credential even when it contains many facilities. Test, disaster-recovery or separately operated installations receive separate credentials.

Raw tokens are returned with `Cache-Control: no-store`. The customer enters only the one-time activation token in the application onboarding screen. The application backend exchanges it server-to-server and writes the returned deployment credential to an encrypted server-side credential store. Never expose the credential to browser storage or place it in environment files, logs, URLs, source control or screenshots.

The scoring API implements token issuance and exchange today. Activation-token generation in the scoring administration UI, plus the main application's activation screen and encrypted credential store, remain pending. Until that complete flow exists, scoring must fail closed.

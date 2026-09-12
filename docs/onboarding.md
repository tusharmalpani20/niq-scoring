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

Raw tokens are returned with `Cache-Control: no-store`. Put the deployment credential directly into protected application configuration and never into logs, URLs, source control or screenshots.

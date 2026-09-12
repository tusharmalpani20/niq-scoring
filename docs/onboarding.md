# Controlled onboarding

There is no public signup.

1. An NIQ administrator creates an organization and its first deployment.
2. NIQ assigns approved rule policy and nullable monthly limits (`null` means unlimited).
3. NIQ generates a short-lived, one-time activation secret.
4. The customer enters it into its application deployment.
5. The scoring platform exchanges it for a deployment identity; only credential hashes and safe metadata are retained.
6. Credentials can be rotated or revoked per environment without affecting other installations.

One central Apollo production installation therefore uses one production deployment credential even when it contains many facilities. Test, disaster-recovery or separately operated installations receive separate credentials.

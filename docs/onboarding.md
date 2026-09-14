# Controlled onboarding

There is no public signup. NIQ staff first sign in to the scoring console using their own administrator accounts; see [Administrator accounts](authentication.md). Staff invitations are separate from the client deployment activation described below.

1. An NIQ administrator creates a client and its first deployment.
2. Each deployment belongs directly to one client.
3. NIQ assigns each deployment its rule policy and nullable monthly limits (`null` means unlimited).
4. NIQ generates a short-lived, one-time activation secret.
5. The client enters it into its application deployment.
6. The scoring platform exchanges it once for a deployment credential; only hashes and safe metadata are retained.
7. Credentials can be revoked per deployment without affecting other installations.

One central Apollo production installation therefore uses one production deployment credential even when it contains many facilities. Test, disaster-recovery or separately operated installations receive separate credentials.

Raw tokens are returned with `Cache-Control: no-store`. The client enters only the one-time activation token in the application onboarding screen. The application backend exchanges it server-to-server and writes the returned deployment credential to an encrypted server-side credential store. Never expose the credential to browser storage or place it in environment files, logs, URLs, source control or screenshots.

The scoring API and administration UI implement activation-token issuance. The main application's organization screen exchanges the token server-to-server and encrypts the returned credential. Assessment submission to scoring remains separate work; activation alone does not mean that clinical scoring is available.

Client creation needs only a name. Activation tokens identify a specific deployment; no external client reference is required. All credentials for a deployment share its monthly allowance, including after credential replacement. Allowances are independent across deployments of the same client.

Administrators create and edit deployments from a single configuration dialog. A configuration save writes the deployment details, both capability limits and the rule assignment in one transaction. A deployment cannot be moved to a different client through this editor. Existing credentials and usage remain attached to its unchanged deployment ID.

Hosting type records whether the installation is NIQ hosted, in the client's cloud, or on-premises. This is descriptive metadata; choosing it does not provision infrastructure. Older deployments have no hosting type until an administrator selects one.

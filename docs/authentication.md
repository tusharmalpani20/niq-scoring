# Administrator accounts

This console is restricted to NIQ staff. Every account currently has the same NIQ administrator permissions, including client configuration and administrator user management. Clients and clinicians do not sign in here. Client deployment credentials authenticate a separate set of service-to-service endpoints.

## First administrator

1. Apply the database migrations with `bun run db:migrate`.
2. Configure an independent high-entropy `ADMIN_BOOTSTRAP_TOKEN` in the protected API environment. Do not reuse a client activation token or deployment credential.
3. Open the console at `http://localhost:4173`. On a fresh database it presents first-administrator setup.
4. Enter the setup token, administrator name, email address and a password of 8–128 characters.
5. Sign in with the new account. Setup does not automatically create a session.
6. Remove `ADMIN_BOOTSTRAP_TOKEN` from the runtime configuration and restart the API. Setup remains closed once an account exists, even if the token is retained accidentally.

Existing client and deployment records are unaffected. The former shared administration bearer token can no longer unlock the console or authorize `/admin/*` requests.

## Additional administrators

Open **Users** and invite an administrator by name and email. The console displays a one-time invitation link; share it privately with that person. This phase does not send invitation email automatically. The recipient opens the link, chooses their own password and then signs in normally. Administrators do not choose or see another user's password.

Invitations expire after 48 hours and can be revoked from Users. Only hashes of invitation tokens are stored. The raw token is shown when issued and cannot be retrieved later; revoke and create a replacement if the link is lost. Accepting an invitation ends any existing console session in that browser so the recipient signs in explicitly with their new account.

An administrator can deactivate another user's access and reactivate it later. Deactivation invalidates existing sessions. Self-deactivation is blocked to avoid locking the current administrator out.

## Session boundary

Passwords are stored using Argon2id. Sessions last eight hours and use random opaque tokens in HttpOnly, SameSite=Strict cookies, with Secure enabled in production. Only token hashes are persisted. Sign-out revokes the session on the server. Cookies and credentials are not placed in browser local storage.

Authentication attempts are rate limited in PostgreSQL, so the limit is shared across API instances. Cookie-authenticated mutations validate browser origin against the configured exact origin allow-list. Account-management actions are attributed to named administrators in the audit stream.

## Scope of this first phase

The console uses shadcn/ui components and separate pages for Overview, Users, Clients, Clients, Deployments and Rule versions. Forms use shadcn Field components with React Hook Form and Zod validation, including field-level error messages. This change establishes administrator access and navigation; it does not implement clinical rule approval or provider integration.

MFA/SSO, self-service password recovery and automated invitation email delivery remain follow-up work. Complete the required workforce MFA integration before production rollout. Do not restore the old shared-token administration bypass as a workaround for account recovery.

# Architecture

The scoring platform is a separate trust boundary from the NIQ clinical application. The application sends a pseudonymous assessment reference and only the facts required for calculation. Patient names, contact data, documents and images remain in the clinical application unless an approved integration explicitly requires otherwise.

Entity identifiers are canonical 26-character uppercase Crockford ULIDs generated
by the application before database insertion. PostgreSQL does not generate them.
Provider references, request IDs and idempotency keys remain opaque external values;
secrets use independent cryptographic randomness and only hashes are persisted.

Entity identifiers are canonical 26-character uppercase Crockford ULIDs generated
by the application before database insertion. PostgreSQL does not generate them.
Provider references, request IDs and idempotency keys remain opaque external values;
secrets use independent cryptographic randomness and only hashes are persisted.

## Phase 1

- One India-hosted scoring deployment.
- Each customer application deployment has an independently revocable credential.
- The scoring API verifies organization, deployment-to-organization authorization, entitlement, quota and assigned version before calculation.
- Full results live in the calling application. The scoring platform retains minimum usage, version and audit evidence.
- Face-scan callbacks terminate at the scoring platform. On-premises callers poll outbound over HTTPS; the platform never needs inbound access to hospital infrastructure.

## Later regionalization

Add regional data-plane nodes (EU/US) behind the same contracts. A control plane distributes signed, immutable rule packages and organization entitlements; it does not replicate patient identity or clinical records. A node continues using its last verified approved package if synchronization is temporarily unavailable.

The scoring platform uses **organization** as the single authoritative term for the application tenant/customer security boundary. Facilities stay inside the clinical application and are not scoring tenants.

## Rule lifecycle

`DRAFT -> VALIDATED -> APPROVED -> ACTIVE -> RETIRED`

Published versions are immutable. Corrections create a new version. An assessment result records version identifier, package checksum, calculation timestamp, input snapshot, component breakdown and request identifier.

An organization has exactly one current assignment policy:

- `LATEST_APPROVED`: resolve the latest approved version at calculation time and stamp that concrete version on the result.
- `PINNED`: always use the assignment's required concrete version until a new assignment supersedes it.

Assignments and entitlements are effective-dated history. Changing either closes the current row and creates a new row; history is never overwritten.

## Availability

If scoring is disabled, over quota or unreachable, the main application saves the assessment as pending and permits retry. It must not invent a score. Historical results remain readable.

## Atomic request accounting

Production calculation and face-scan creation must use one database transaction that:

1. Authenticates the credential and locks/resolves its deployment and organization allow-list.
2. Returns an existing usage result for the same deployment, capability and idempotency key.
3. Locks the current entitlement or a dedicated monthly counter row.
4. Checks the effective entitlement and monthly successful/billable usage.
5. Creates the pending usage event before external work, then records the terminal outcome.

PostgreSQL serializes reservations by locking the current entitlement row, while the unique idempotency index is the final duplicate guard. Pending reservations count against the quota so simultaneous requests cannot exceed it. Failed calculations may retry the same idempotency key; successful results are returned without recalculation or double billing. Calendar-month accounting uses UTC.

Face-scan creation currently uses a provider adapter boundary and returns `REQUESTED`. Its pending reservation prevents quota overrun and its stored response makes retries idempotent. A real CarePlix adapter and signed webhook state transitions require approved provider documentation and credentials.

## Administration boundary

There is no public signup. A high-entropy bootstrap token authorizes creation of the first named NIQ administrator only. After setup, NIQ administrators authenticate through individual email/password accounts and opaque cookie sessions. They can invite other NIQ administrators and deactivate accounts. All console users have the same NIQ administrator permissions in this phase; customer credentials remain a separate machine-to-machine boundary.

See [Administrator accounts](authentication.md) for session, invitation and setup behavior. MFA/SSO and password recovery remain follow-up work before production rollout.

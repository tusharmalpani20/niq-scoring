import { createEntityId } from "./lib/id";
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  passwordHash: string;
}
export interface AdminInvitation {
  id: string;
  email: string;
  displayName: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}
export interface AdminSession {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}
export interface AuthAudit {
  actorId?: string;
  action: string;
  resourceId?: string;
  requestId: string;
}
export interface AdminAuthStore {
  hasUsers(): Promise<boolean>;
  findUser(email: string): Promise<AdminUser | undefined>;
  sessionUser(tokenHash: string, now: string): Promise<AdminUser | undefined>;
  consumeAttempt(key: string, now: string, limit: number): Promise<boolean>;
  bootstrap(user: AdminUser, audit: AuthAudit): Promise<boolean>;
  createSession(session: AdminSession, audit: AuthAudit): Promise<boolean>;
  logout(tokenHash: string, audit: AuthAudit): Promise<void>;
  list(
    now: string,
  ): Promise<{ users: AdminUser[]; invitations: AdminInvitation[] }>;
  invite(invitation: AdminInvitation, audit: AuthAudit): Promise<boolean>;
  findInvitation(
    tokenHash: string,
    now: string,
  ): Promise<AdminInvitation | undefined>;
  acceptInvitation(
    tokenHash: string,
    user: AdminUser,
    now: string,
    audit: AuthAudit,
  ): Promise<boolean>;
  revokeInvitation(id: string, audit: AuthAudit): Promise<boolean>;
  setEnabled(
    id: string,
    enabled: boolean,
    audit: AuthAudit,
  ): Promise<"OK" | "NOT_FOUND" | "ADMIN_LOCKOUT_PREVENTED">;
}
export class MemoryAdminAuthStore implements AdminAuthStore {
  state: {
    users: AdminUser[];
    invitations: AdminInvitation[];
    sessions: AdminSession[];
    attempts: { key: string; count: number; expiresAt: string }[];
  } = { users: [], invitations: [], sessions: [], attempts: [] };
  audits: AuthAudit[] = [];
  async hasUsers() {
    return this.state.users.length > 0;
  }
  async findUser(email: string) {
    return this.state.users.find((u) => u.email === email);
  }
  async sessionUser(tokenHash: string, now: string) {
    const session = this.state.sessions.find(
      (s) => s.tokenHash === tokenHash && s.expiresAt > now,
    );
    return session
      ? this.state.users.find((u) => u.id === session.userId && u.enabled)
      : undefined;
  }
  async consumeAttempt(key: string, now: string, limit: number) {
    this.state.attempts = this.state.attempts.filter((a) => a.expiresAt > now);
    let a = this.state.attempts.find((a) => a.key === key);
    if (!a) {
      a = {
        key,
        count: 0,
        expiresAt: new Date(Date.parse(now) + 900_000).toISOString(),
      };
      this.state.attempts.push(a);
    }
    return ++a.count <= limit;
  }
  async bootstrap(user: AdminUser, audit: AuthAudit) {
    if (this.state.users.length) return false;
    this.state.users.push(user);
    this.audits.push(audit);
    return true;
  }
  async createSession(session: AdminSession, audit: AuthAudit) {
    if (!this.state.users.some((u) => u.id === session.userId && u.enabled))
      return false;
    this.state.sessions.push(session);
    this.audits.push(audit);
    return true;
  }
  async logout(tokenHash: string, audit: AuthAudit) {
    this.state.sessions = this.state.sessions.filter(
      (s) => s.tokenHash !== tokenHash,
    );
    this.audits.push(audit);
  }
  async list(now: string) {
    return {
      users: this.state.users,
      invitations: this.state.invitations.filter((i) => i.expiresAt > now),
    };
  }
  async invite(invitation: AdminInvitation, audit: AuthAudit) {
    this.state.invitations = this.state.invitations.filter(
      (i) => i.expiresAt > invitation.createdAt,
    );
    if (
      this.state.users.some((u) => u.email === invitation.email) ||
      this.state.invitations.some((i) => i.email === invitation.email)
    )
      return false;
    this.state.invitations.push(invitation);
    this.audits.push(audit);
    return true;
  }
  async findInvitation(tokenHash: string, now: string) {
    return this.state.invitations.find(
      (i) => i.tokenHash === tokenHash && i.expiresAt > now,
    );
  }
  async acceptInvitation(
    tokenHash: string,
    user: AdminUser,
    now: string,
    audit: AuthAudit,
  ) {
    const i = this.state.invitations.find(
      (i) =>
        i.tokenHash === tokenHash &&
        i.expiresAt > now &&
        i.email === user.email,
    );
    if (!i || this.state.users.some((u) => u.email === user.email))
      return false;
    this.state.invitations = this.state.invitations.filter(
      (x) => x.id !== i.id,
    );
    this.state.users.push(user);
    this.audits.push(audit);
    return true;
  }
  async revokeInvitation(id: string, audit: AuthAudit) {
    const exists = this.state.invitations.some((i) => i.id === id);
    this.state.invitations = this.state.invitations.filter((i) => i.id !== id);
    if (exists) this.audits.push(audit);
    return exists;
  }
  async setEnabled(id: string, enabled: boolean, audit: AuthAudit) {
    const user = this.state.users.find((u) => u.id === id);
    if (!user) return "NOT_FOUND" as const;
    if (
      !enabled &&
      (id === audit.actorId ||
        this.state.users.filter((u) => u.enabled).length <= 1)
    )
      return "ADMIN_LOCKOUT_PREVENTED" as const;
    user.enabled = enabled;
    if (!enabled)
      this.state.sessions = this.state.sessions.filter((s) => s.userId !== id);
    this.audits.push(audit);
    return "OK" as const;
  }
}

type Sql = import("postgres").Sql;
type Transaction = import("postgres").TransactionSql;
const normalize = <T>(row: T): T => JSON.parse(JSON.stringify(row));
const userColumns =
  'id,email,display_name as "displayName",password_hash as "passwordHash",enabled,created_at as "createdAt"';
const invitationColumns =
  'id,email,display_name as "displayName",token_hash as "tokenHash",expires_at as "expiresAt",created_at as "createdAt"';
export class PostgresAdminAuthStore implements AdminAuthStore {
  constructor(private readonly sql: Sql) {}
  private async audit(sql: Transaction, event: AuthAudit) {
    await sql`insert into audit_events (id,actor_type,actor_reference,action,resource_type,resource_reference,request_id,outcome) values (${createEntityId()},'NIQ_ADMIN',${event.actorId ?? null},${event.action},'ADMIN_USER',${event.resourceId ?? null},${event.requestId},'SUCCEEDED')`;
  }
  private async insertUser(sql: Transaction, u: AdminUser) {
    await sql`insert into admin_users (id,email,display_name,password_hash,enabled,created_at) values (${u.id},${u.email},${u.displayName},${u.passwordHash},${u.enabled},${u.createdAt})`;
  }
  async hasUsers() {
    const [r] = await this
      .sql`select exists(select 1 from admin_users) as present`;
    return r!.present as boolean;
  }
  async findUser(email: string) {
    const [r] = await this.sql<
      AdminUser[]
    >`select ${this.sql.unsafe(userColumns)} from admin_users where email = ${email}`;
    return r ? normalize(r) : undefined;
  }
  async sessionUser(tokenHash: string, now: string) {
    const [r] = await this.sql<
      AdminUser[]
    >`select u.id,u.email,u.display_name as "displayName",u.password_hash as "passwordHash",u.enabled,u.created_at as "createdAt" from admin_users u join admin_sessions s on s.user_id = u.id where s.token_hash = ${tokenHash} and s.expires_at > ${now} and u.enabled`;
    return r ? normalize(r) : undefined;
  }
  async consumeAttempt(key: string, now: string, limit: number) {
    // One cleanup on the shared budget bounds rows left by arbitrary-email attacks.
    if (key === "login-global") {
      await this
        .sql`delete from admin_auth_attempts where expires_at <= ${now} and key in (select key from admin_auth_attempts where expires_at <= ${now} limit 1000)`;
    }
    const expiresAt = new Date(Date.parse(now) + 900_000).toISOString();
    const [r] = await this
      .sql`insert into admin_auth_attempts (key,count,expires_at) values (${key},1,${expiresAt}) on conflict (key) do update set count = case when admin_auth_attempts.expires_at <= ${now} then 1 else admin_auth_attempts.count + 1 end, expires_at = case when admin_auth_attempts.expires_at <= ${now} then ${expiresAt} else admin_auth_attempts.expires_at end returning count`;
    return r!.count <= limit;
  }
  async bootstrap(user: AdminUser, event: AuthAudit) {
    let created = false;
    await this.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(74120916)`;
      const [r] =
        await sql`select exists(select 1 from admin_users) as present`;
      if (r!.present) return;
      await this.insertUser(sql, user);
      await this.audit(sql, event);
      created = true;
    });
    return created;
  }
  async createSession(session: AdminSession, event: AuthAudit) {
    let created = false;
    await this.sql.begin(async (sql) => {
      const [u] =
        await sql`select id from admin_users where id = ${session.userId} and enabled for update`;
      if (!u) return;
      await sql`delete from admin_sessions where expires_at <= now()`;
      await sql`insert into admin_sessions (token_hash,user_id,expires_at) values (${session.tokenHash},${session.userId},${session.expiresAt})`;
      await this.audit(sql, event);
      created = true;
    });
    return created;
  }
  async logout(tokenHash: string, event: AuthAudit) {
    await this.sql.begin(async (sql) => {
      await sql`delete from admin_sessions where token_hash = ${tokenHash}`;
      await this.audit(sql, event);
    });
  }
  async list(now: string) {
    const [users, invitations] = await Promise.all([
      this.sql<
        AdminUser[]
      >`select ${this.sql.unsafe(userColumns)} from admin_users order by created_at`,
      this.sql<
        AdminInvitation[]
      >`select ${this.sql.unsafe(invitationColumns)} from admin_invitations where expires_at > ${now} order by created_at`,
    ]);
    return normalize({ users: [...users], invitations: [...invitations] });
  }
  async invite(i: AdminInvitation, event: AuthAudit) {
    let created = false;
    await this.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(74120916)`;
      await sql`delete from admin_invitations where expires_at <= ${i.createdAt}`;
      const [r] =
        await sql`select exists(select 1 from admin_users where email = ${i.email}) or exists(select 1 from admin_invitations where email = ${i.email}) as present`;
      if (r!.present) return;
      await sql`insert into admin_invitations (id,email,display_name,token_hash,expires_at,created_at) values (${i.id},${i.email},${i.displayName},${i.tokenHash},${i.expiresAt},${i.createdAt})`;
      await this.audit(sql, event);
      created = true;
    });
    return created;
  }
  async findInvitation(tokenHash: string, now: string) {
    const [r] = await this.sql<
      AdminInvitation[]
    >`select ${this.sql.unsafe(invitationColumns)} from admin_invitations where token_hash = ${tokenHash} and expires_at > ${now}`;
    return r ? normalize(r) : undefined;
  }
  async acceptInvitation(
    tokenHash: string,
    user: AdminUser,
    now: string,
    event: AuthAudit,
  ) {
    let accepted = false;
    await this.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(74120916)`;
      const [i] =
        await sql`delete from admin_invitations where token_hash = ${tokenHash} and expires_at > ${now} and email = ${user.email} returning id`;
      if (!i) return;
      await this.insertUser(sql, user);
      await this.audit(sql, event);
      accepted = true;
    });
    return accepted;
  }
  async revokeInvitation(id: string, event: AuthAudit) {
    let revoked = false;
    await this.sql.begin(async (sql) => {
      const [i] =
        await sql`delete from admin_invitations where id = ${id} returning id`;
      if (i) {
        await this.audit(sql, event);
        revoked = true;
      }
    });
    return revoked;
  }
  async setEnabled(
    id: string,
    enabled: boolean,
    event: AuthAudit,
  ): Promise<"OK" | "NOT_FOUND" | "ADMIN_LOCKOUT_PREVENTED"> {
    let result: "OK" | "NOT_FOUND" | "ADMIN_LOCKOUT_PREVENTED" = "NOT_FOUND";
    await this.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(74120916)`;
      const [user] =
        await sql`select id from admin_users where id = ${id} for update`;
      if (!user) return;
      const [r] =
        await sql`select count(*)::int as count from admin_users where enabled`;
      if (!enabled && (id === event.actorId || r!.count <= 1)) {
        result = "ADMIN_LOCKOUT_PREVENTED";
        return;
      }
      await sql`update admin_users set enabled = ${enabled} where id = ${id}`;
      if (!enabled) await sql`delete from admin_sessions where user_id = ${id}`;
      await this.audit(sql, event);
      result = "OK";
    });
    return result;
  }
}

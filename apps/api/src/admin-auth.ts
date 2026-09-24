import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { createEntityId } from "./lib/id";
import { type AdminAuthStore, type AdminUser } from "./admin-auth-store";

const cookieName = "niq_scoring_session";
const password = z.string().min(8).max(128);
const profile = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  displayName: z.string().trim().min(1).max(120),
});
const safeUser = ({ passwordHash: _, ...user }: AdminUser) => user;
const hash = (value: string) =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");
const secret = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const json = (c: Context) => c.req.json().catch(() => null);
// One shared dummy hash makes unknown-account verification use the same expensive path.
const dummyHash = Bun.password.hash(secret(), { algorithm: "argon2id" });
export function installAdminAuth(
  app: Hono,
  options: {
    authStore: AdminAuthStore;
    adminBootstrapToken?: string;
    allowedOrigins: string[];
    runtimeEnvironment: string;
    now?: () => Date;
  },
) {
  const store = options.authStore;
  const now = options.now ?? (() => new Date());
  const audit = (
    c: Context,
    action: string,
    actorId?: string,
    resourceId?: string,
  ) => ({
    action,
    requestId: c.res.headers.get("x-request-id") ?? crypto.randomUUID(),
    ...(actorId ? { actorId } : {}),
    ...(resourceId ? { resourceId } : {}),
  });
  const currentUser = (c: Context) =>
    store.sessionUser(
      hash(getCookie(c, cookieName) ?? ""),
      now().toISOString(),
    );
  const clearSession = async (c: Context) => {
    const user = await currentUser(c);
    await store.logout(
      hash(getCookie(c, cookieName) ?? ""),
      audit(c, "ADMIN_LOGOUT", user?.id, user?.id),
    );
    deleteCookie(c, cookieName, {
      path: "/",
      secure: options.runtimeEnvironment === "production",
      sameSite: "Strict",
    });
  };
  const makeUser = async (data: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<AdminUser> => ({
    id: createEntityId(),
    email: data.email,
    displayName: data.displayName,
    enabled: true,
    createdAt: now().toISOString(),
    passwordHash: await Bun.password.hash(data.password, {
      algorithm: "argon2id",
    }),
  });
  const originGuard = async (c: Context, next: () => Promise<void>) => {
    c.header("cache-control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (
        !origin ||
        (!options.allowedOrigins.includes(origin) &&
          (options.runtimeEnvironment === "production" ||
            origin !== new URL(c.req.url).origin))
      )
        return c.json({ error: "INVALID_ORIGIN" }, 403);
    }
    await next();
  };
  app.use("/auth/*", originGuard);
  app.use("/admin/*", originGuard);
  app.use("/admin/*", async (c, next) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "UNAUTHORIZED" }, 401);
    c.set("adminUserId", user.id);
    await next();
  });
  app.get("/auth/status", async (c) =>
    c.json({ setupRequired: !(await store.hasUsers()) }),
  );
  app.post("/auth/setup", async (c) => {
    const body = profile
      .extend({ setupToken: z.string().max(512), password })
      .safeParse(await json(c));
    if (!body.success) return c.json({ error: "INVALID_REQUEST" }, 400);
    if (await store.hasUsers()) return c.json({ error: "SETUP_COMPLETE" }, 409);
    const setupAttempt = await store.consumeAttempt(
      "setup",
      now().toISOString(),
      10,
    );
    if (!setupAttempt.allowed) {
      c.header("Retry-After", String(setupAttempt.retryAfterSeconds));
      return c.json({ error: "RATE_LIMITED" }, 429);
    }
    if (
      !options.adminBootstrapToken ||
      hash(body.data.setupToken) !== hash(options.adminBootstrapToken)
    )
      return c.json({ error: "INVALID_SETUP_TOKEN" }, 401);
    const user = await makeUser(body.data);
    return (await store.bootstrap(
      user,
      audit(c, "ADMIN_SETUP", user.id, user.id),
    ))
      ? c.json({ success: true }, 201)
      : c.json({ error: "SETUP_COMPLETE" }, 409);
  });
  app.post("/auth/login", async (c) => {
    const body = z
      .object({
        email: z.string().trim().toLowerCase().max(254),
        password: z.string().min(1).max(128),
      })
      .safeParse(await json(c));
    if (!body.success) return c.json({ error: "INVALID_REQUEST" }, 400);
    const loginAttempt = await store.consumeAttempt(
      `login:${hash(body.data.email)}`,
      now().toISOString(),
      10,
    );
    if (!loginAttempt.allowed) {
      c.header("Retry-After", String(loginAttempt.retryAfterSeconds));
      return c.json({ error: "RATE_LIMITED" }, 429);
    }
    const user = await store.findUser(body.data.email);
    const valid = await Bun.password.verify(
      body.data.password,
      user?.passwordHash ?? (await dummyHash),
    );
    if (!user || !user.enabled || !valid)
      return c.json({ error: "INVALID_CREDENTIALS" }, 401);
    const token = secret();
    if (
      !(await store.createSession(
        {
          tokenHash: hash(token),
          userId: user.id,
          expiresAt: new Date(now().getTime() + 8 * 60 * 60_000).toISOString(),
        },
        audit(c, "ADMIN_LOGIN", user.id, user.id),
      ))
    )
      return c.json({ error: "INVALID_CREDENTIALS" }, 401);
    setCookie(c, cookieName, token, {
      httpOnly: true,
      secure: options.runtimeEnvironment === "production",
      sameSite: "Strict",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return c.json({ user: safeUser(user) });
  });
  app.get("/auth/session", async (c) => {
    const user = await currentUser(c);
    return user
      ? c.json({ user: safeUser(user) })
      : c.json({ error: "UNAUTHORIZED" }, 401);
  });
  app.post("/auth/logout", async (c) => {
    await clearSession(c);
    return c.json({ success: true });
  });
  app.get("/admin/users", async (c) => {
    const result = await store.list(now().toISOString());
    return c.json({
      users: result.users.map(safeUser),
      invitations: result.invitations.map(({ tokenHash: _, ...i }) => i),
    });
  });
  app.post("/admin/users/invitations", async (c) => {
    const body = profile.safeParse(await json(c));
    if (!body.success) return c.json({ error: "INVALID_REQUEST" }, 400);
    const user = await currentUser(c);
    if (!user) return c.json({ error: "UNAUTHORIZED" }, 401);
    const token = secret();
    const expiresAt = new Date(
      now().getTime() + 48 * 60 * 60_000,
    ).toISOString();
    const id = createEntityId();
    const created = await store.invite(
      {
        ...body.data,
        id,
        tokenHash: hash(token),
        createdAt: now().toISOString(),
        expiresAt,
      },
      audit(c, "ADMIN_INVITED", user.id, id),
    );
    return created
      ? c.json({ invitationToken: token, expiresAt }, 201)
      : c.json({ error: "EMAIL_ALREADY_EXISTS" }, 409);
  });
  app.post("/auth/accept-invitation", async (c) => {
    const body = z
      .object({ invitationToken: z.string().min(32).max(128), password })
      .safeParse(await json(c));
    if (!body.success) return c.json({ error: "INVALID_REQUEST" }, 400);
    const invitation = await store.findInvitation(
      hash(body.data.invitationToken),
      now().toISOString(),
    );
    if (!invitation)
      return c.json({ error: "INVITATION_INVALID_OR_EXPIRED" }, 401);
    const user = await makeUser({
      ...invitation,
      password: body.data.password,
    });
    const accepted = await store.acceptInvitation(
      hash(body.data.invitationToken),
      user,
      now().toISOString(),
      audit(c, "ADMIN_INVITATION_ACCEPTED", user.id, user.id),
    );
    if (!accepted)
      return c.json({ error: "INVITATION_INVALID_OR_EXPIRED" }, 401);
    // Account acceptance returns to login, so an earlier account must not persist.
    if (getCookie(c, cookieName)) await clearSession(c);
    return c.json({ success: true }, 201);
  });
  app.delete("/admin/users/invitations/:id", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "UNAUTHORIZED" }, 401);
    return (await store.revokeInvitation(
      c.req.param("id"),
      audit(c, "ADMIN_INVITATION_REVOKED", user.id, c.req.param("id")),
    ))
      ? c.json({ success: true })
      : c.json({ error: "NOT_FOUND" }, 404);
  });
  app.patch("/admin/users/:id/enabled", async (c) => {
    const body = z.object({ enabled: z.boolean() }).safeParse(await json(c));
    if (!body.success) return c.json({ error: "INVALID_REQUEST" }, 400);
    const user = await currentUser(c);
    if (!user) return c.json({ error: "UNAUTHORIZED" }, 401);
    const result = await store.setEnabled(
      c.req.param("id"),
      body.data.enabled,
      audit(
        c,
        body.data.enabled ? "ADMIN_ENABLED" : "ADMIN_DISABLED",
        user.id,
        c.req.param("id"),
      ),
    );
    return result === "OK"
      ? c.json({ success: true })
      : c.json({ error: result }, result === "NOT_FOUND" ? 404 : 409);
  });
}

declare module "hono" { interface ContextVariableMap { adminUserId: string; } }

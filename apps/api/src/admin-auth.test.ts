import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { MemoryScoringStore } from "./store";
const setupToken = "independent-setup-secret-longer-than-32-characters";
const password = "correct-horse-battery-staple";
const origin = "http://localhost:4173";
function fixture() {
  const authStore = new MemoryAdminAuthStore();
  let date = new Date("2026-09-13T00:00:00Z");
  const app = createApp({
    store: new MemoryScoringStore(),
    authStore,
    adminBootstrapToken: setupToken,
    allowedOrigins: [origin],
    region: "india",
    runtimeEnvironment: "production",
    provisionalScoringRequested: false,
    now: () => date,
  });
  const request = (
    path: string,
    body?: unknown,
    cookie = "",
    method = "POST",
  ) =>
    app.request(path, {
      method,
      headers: { origin, cookie, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const setup = () =>
    request("/auth/setup", {
      setupToken,
      email: " ADMIN@niq.test ",
      displayName: "Admin",
      password,
    });
  const login = async (email = "admin@niq.test") => {
    const response = await request("/auth/login", { email, password });
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")!.split(";")[0]!;
  };
  return {
    app,
    authStore,
    request,
    setup,
    login,
    advance: (milliseconds: number) => {
      date = new Date(date.getTime() + milliseconds);
    },
  };
}
describe("NIQ named administrator authentication", () => {
  test("setup accepts eight-character passwords and rejects shorter ones", async () => {
    const f = fixture();
    for (const password of ["1234567", "12345678"]) {
      const response = await f.request("/auth/setup", {
        setupToken,
        email: "admin@niq.test",
        displayName: "Admin",
        password,
      });
      expect(response.status).toBe(password.length === 8 ? 201 : 400);
    }
    expect((await f.request("/auth/login", {
      email: "admin@niq.test",
      password: "12345678",
    })).status).toBe(200);
  });
  test("first setup is one-time, normalized, hashed, and does not log in", async () => {
    const f = fixture();
    expect(await (await f.app.request("/auth/status")).json()).toEqual({
      setupRequired: true,
    });
    const responses = await Promise.all([f.setup(), f.setup()]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(f.authStore.state.users).toHaveLength(1);
    expect(f.authStore.state.users[0]!.email).toBe("admin@niq.test");
    expect(f.authStore.state.users[0]!.passwordHash).toStartWith("$argon2id$");
    expect(
      responses.find((r) => r.status === 201)!.headers.get("set-cookie"),
    ).toBeNull();
    expect(
      (
        await f.app.request("/admin/overview", {
          headers: { authorization: `Bearer ${setupToken}` },
        })
      ).status,
    ).toBe(401);
    expect((await f.app.request("/auth/session")).status).toBe(401);
  });
  test("secure sessions expire and logout revokes them", async () => {
    const f = fixture();
    await f.setup();
    const response = await f.request("/auth/login", {
      email: "admin@niq.test",
      password,
    });
    const header = response.headers.get("set-cookie")!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Secure");
    const cookie = header.split(";")[0]!;
    const session = await f.request("/auth/session", undefined, cookie, "GET");
    expect(session.status).toBe(200);
    expect(await session.json()).not.toHaveProperty("user.passwordHash");
    await f.request("/auth/logout", undefined, cookie);
    expect(
      (await f.request("/auth/session", undefined, cookie, "GET")).status,
    ).toBe(401);
    const second = await f.login();
    f.advance(8 * 3600_000);
    expect(
      (await f.request("/admin/users", undefined, second, "GET")).status,
    ).toBe(401);
  });
  test("invites are one-time, duplicates rejected and disabling revokes sessions", async () => {
    const f = fixture();
    await f.setup();
    const adminCookie = await f.login();
    const invite = { email: "SECOND@niq.test", displayName: "Second Admin" };
    const response = await f.request(
      "/admin/users/invitations",
      invite,
      adminCookie,
    );
    expect(response.status).toBe(201);
    const { invitationToken } = (await response.json()) as {
      invitationToken: string;
    };
    expect(f.authStore.state.invitations[0]!.tokenHash).not.toBe(
      invitationToken,
    );
    expect(
      (await f.request("/admin/users/invitations", invite, adminCookie)).status,
    ).toBe(409);
    const accept = { invitationToken, password };
    expect((await f.request("/auth/accept-invitation", accept)).status).toBe(
      201,
    );
    expect((await f.request("/auth/accept-invitation", accept)).status).toBe(
      401,
    );
    const secondCookie = await f.login("second@niq.test");
    const first = f.authStore.state.users[0]!;
    const second = f.authStore.state.users[1]!;
    expect(
      (
        await f.request(
          `/admin/users/${first.id}/enabled`,
          { enabled: false },
          adminCookie,
          "PATCH",
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await f.request(
          `/admin/users/${second.id}/enabled`,
          { enabled: false },
          adminCookie,
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(
      (await f.request("/admin/users", undefined, secondCookie, "GET")).status,
    ).toBe(401);
    expect(
      (await f.request("/auth/login", { email: second.email, password }))
        .status,
    ).toBe(401);
    expect(f.authStore.audits.map((a) => a.action)).toContain("ADMIN_DISABLED");
  });
  test("accepting an invitation clears an existing account session", async () => {
    const f = fixture();
    await f.setup();
    const cookie = await f.login();
    const invitation = await (
      await f.request(
        "/admin/users/invitations",
        {
          email: "new@niq.test",
          displayName: "New Admin",
        },
        cookie,
      )
    ).json();
    const accepted = await f.request(
      "/auth/accept-invitation",
      { ...invitation, password },
      cookie,
    );
    expect(accepted.status).toBe(201);
    expect(accepted.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
      (await f.request("/auth/session", undefined, cookie, "GET")).status,
    ).toBe(401);
    await f.login("new@niq.test");
  });

  test("revoked and expired invitations cannot create accounts", async () => {
    const f = fixture();
    await f.setup();
    const cookie = await f.login();
    const response = await f.request(
      "/admin/users/invitations",
      { email: "invite@niq.test", displayName: "Invite" },
      cookie,
    );
    const body = await response.json();
    const id = f.authStore.state.invitations[0]!.id;
    expect(
      (
        await f.request(
          `/admin/users/invitations/${id}`,
          undefined,
          cookie,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect(
      (await f.request("/auth/accept-invitation", { ...body, password }))
        .status,
    ).toBe(401);
    const next = await (
      await f.request(
        "/admin/users/invitations",
        { email: "invite@niq.test", displayName: "Invite" },
        cookie,
      )
    ).json();
    f.advance(48 * 3600_000);
    expect(
      (await f.request("/auth/accept-invitation", { ...next, password }))
        .status,
    ).toBe(401);
  });
  test("mutation origin checks and setup rate limit fail closed", async () => {
    const f = fixture();
    expect(
      (await f.app.request("/auth/setup", { method: "POST" })).status,
    ).toBe(403);
    expect(
      (
        await f.app.request("/auth/login", {
          method: "POST",
          headers: { origin: "https://evil.test" },
        })
      ).status,
    ).toBe(403);
    for (let i = 0; i < 10; i++)
      expect(
        (
          await f.request("/auth/setup", {
            setupToken: "wrong",
            email: "a@niq.test",
            displayName: "A",
            password,
          })
        ).status,
      ).toBe(401);
    const limitedSetup = await f.setup();
    expect(limitedSetup.status).toBe(429);
    expect(limitedSetup.headers.get("retry-after")).toBe("900");
    f.advance(900_001);
    expect((await f.setup()).status).toBe(201);
  });
  test("login attempts are bounded per normalized account", async () => {
    const f = fixture();
    await f.setup();
    for (let i = 0; i < 10; i++)
      expect(
        (
          await f.request("/auth/login", {
            email: "ADMIN@NIQ.TEST",
            password: "incorrect",
          })
        ).status,
      ).toBe(401);
    const limitedLogin = await f.request("/auth/login", {
      email: "admin@niq.test",
      password,
    });
    expect(limitedLogin.status).toBe(429);
    expect(limitedLogin.headers.get("retry-after")).toBe("900");
    expect(
      f.authStore.state.attempts.map((attempt) => attempt.key),
    ).not.toContain("login-global");
    f.advance(300_000);
    const stillLimited = await f.request("/auth/login", {
      email: "admin@niq.test",
      password,
    });
    expect(stillLimited.status).toBe(429);
    expect(stillLimited.headers.get("retry-after")).toBe("600");
    f.advance(600_001);
    await f.login();
  });
  test("attempts against another account do not block a valid admin", async () => {
    const f = fixture();
    await f.setup();
    for (let i = 0; i < 10; i++)
      expect(
        (
          await f.request("/auth/login", {
            email: "unknown@niq.test",
            password: "incorrect",
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await f.request("/auth/login", {
          email: "unknown@niq.test",
          password: "incorrect",
        })
      ).status,
    ).toBe(429);
    await f.login();
  });
});

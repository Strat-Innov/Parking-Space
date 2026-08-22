import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { verifyCredentials } from "@/lib/auth";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { prisma } from "../helpers/db";
import { createUser } from "../helpers/factories";

const PASSWORD = "correct-horse";

async function accountWith(overrides: Record<string, unknown> = {}) {
  return createUser("PREPARED_BY", {
    passwordHash: await bcrypt.hash(PASSWORD, 10),
    ...overrides,
  });
}

function loginRequest(body: unknown) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("verifyCredentials", () => {
  it("returns the user for a correct password", async () => {
    const user = await accountWith();
    const result = await verifyCredentials(user.email, PASSWORD);
    expect(result?.id).toBe(user.id);
  });

  it("matches the email case-insensitively", async () => {
    const user = await accountWith();
    const result = await verifyCredentials(user.email.toUpperCase(), PASSWORD);
    expect(result?.id).toBe(user.id);
  });

  it("returns null for a wrong password", async () => {
    const user = await accountWith();
    expect(await verifyCredentials(user.email, "wrong")).toBeNull();
  });

  it("returns null for an unknown email", async () => {
    expect(await verifyCredentials("nobody@nowhere.test", PASSWORD)).toBeNull();
  });
});

// These branches all return before createSession(), so they are reachable
// without a cookie/request scope. The successful single-role path is NOT
// covered here — see the Phase 0 report's "not yet covered" section.
describe("login route — refusals", () => {
  it("refuses a bad password with 401 and a non-enumerating message", async () => {
    const user = await accountWith();
    const res = await loginRoute(loginRequest({ email: user.email, password: "wrong" }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Invalid email or password." });
  });

  it("gives an unknown email the identical 401 message", async () => {
    const res = await loginRoute(loginRequest({ email: "ghost@nowhere.test", password: PASSWORD }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Invalid email or password." });
  });

  it("refuses a malformed body with 422", async () => {
    const res = await loginRoute(loginRequest({ email: "not-an-email", password: "" }));
    expect(res.status).toBe(422);
  });

  it("refuses a REQUESTER with the generic 401 (requestors never log in)", async () => {
    const user = await createUser("REQUESTER", { passwordHash: await bcrypt.hash(PASSWORD, 10) });
    const res = await loginRoute(loginRequest({ email: user.email, password: PASSWORD }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Invalid email or password." });
  });

  it("refuses the retired CASHIER role with the generic 401", async () => {
    const user = await createUser("PREPARED_BY", {
      role: "CASHIER",
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    });
    const res = await loginRoute(loginRequest({ email: user.email, password: PASSWORD }));
    expect(res.status).toBe(401);
  });

  it("refuses an unconfirmed account with 403 and the unconfirmed flag", async () => {
    const user = await accountWith({ emailVerifiedAt: null });
    const res = await loginRoute(loginRequest({ email: user.email, password: PASSWORD }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ unconfirmed: true });
  });

  it("refuses a deactivated account with 403", async () => {
    const user = await accountWith({ active: false });
    const res = await loginRoute(loginRequest({ email: user.email, password: PASSWORD }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "This account has been deactivated." });
  });
});

describe("login route — multi-role selection", () => {
  it("asks which role when the account holds more than one", async () => {
    const user = await accountWith({ role: "PREPARED_BY", roles: ["PREPARED_BY", "VALIDATED_BY"] });
    const res = await loginRoute(loginRequest({ email: user.email, password: PASSWORD }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      multiRole: true,
      roles: ["PREPARED_BY", "VALIDATED_BY"],
    });
  });

  it("does not ask again for the password when asking for the role", async () => {
    const user = await accountWith({ roles: ["PREPARED_BY", "VALIDATED_BY"] });
    const res = await loginRoute(loginRequest({ email: user.email, password: PASSWORD }));
    const body = await res.json();

    expect(body).not.toHaveProperty("error");
    expect(body.multiRole).toBe(true);
  });

  it("refuses a role the account does not hold with 403", async () => {
    const user = await accountWith({ roles: ["PREPARED_BY", "VALIDATED_BY"] });
    const res = await loginRoute(
      loginRequest({ email: user.email, password: PASSWORD, selectedRole: "DEVELOPER" }),
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Not a role on this account." });
  });

  // NOT covered: the single-role success path. It falls through to
  // createSession(), which needs SESSION_SECRET and a Next.js request scope for
  // cookies(). Asserting "no multiRole prompt" here would pass vacuously off the
  // resulting 500, so it is deliberately left to a future request-scope harness
  // rather than tested misleadingly.
});

describe("User.roles storage", () => {
  it("defaults to an empty array for accounts that predate multi-role", async () => {
    const user = await createUser("PREPARED_BY");
    const reread = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reread.roles).toEqual([]);
  });

  it("stores several roles with `role` as the primary", async () => {
    const user = await createUser("PREPARED_BY", {
      role: "PREPARED_BY",
      roles: ["PREPARED_BY", "VALIDATED_BY", "PARKING_MANAGEMENT"],
    });
    const reread = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    expect(reread.role).toBe("PREPARED_BY");
    expect(reread.roles).toHaveLength(3);
  });
});

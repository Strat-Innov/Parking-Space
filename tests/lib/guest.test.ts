import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { resolveGuestRequesterId } from "@/lib/guest";
import { prisma } from "../helpers/db";
import { createUser } from "../helpers/factories";

describe("guest requester resolution", () => {
  it("creates a REQUESTER row for a first-time anonymous submitter", async () => {
    const id = await resolveGuestRequesterId("Casey Client", "casey@acme.test");
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });

    expect(user.role).toBe("REQUESTER");
    expect(user.name).toBe("Casey Client");
    expect(user.email).toBe("casey@acme.test");
  });

  it("lowercases the email", async () => {
    const id = await resolveGuestRequesterId("Casey", "CASEY@ACME.TEST");
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.email).toBe("casey@acme.test");
  });

  it("reuses the existing row on a repeat submission", async () => {
    const first = await resolveGuestRequesterId("Casey", "casey@acme.test");
    const second = await resolveGuestRequesterId("Casey Again", "casey@acme.test");

    expect(second).toBe(first);
    expect(await prisma.user.count()).toBe(1);
  });

  it("matches an existing account case-insensitively rather than duplicating", async () => {
    const first = await resolveGuestRequesterId("Casey", "casey@acme.test");
    const second = await resolveGuestRequesterId("Casey", "Casey@Acme.Test");

    expect(second).toBe(first);
    expect(await prisma.user.count()).toBe(1);
  });

  it("reuses a pre-existing staff account with the same email", async () => {
    const staff = await createUser("PREPARED_BY", { email: "staff@acme.test" });
    const id = await resolveGuestRequesterId("Someone Else", "staff@acme.test");

    expect(id).toBe(staff.id);
    const reread = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(reread.role).toBe("PREPARED_BY");
    expect(reread.name).toBe(staff.name);
  });

  it("gives the guest row an unusable password hash", async () => {
    const id = await resolveGuestRequesterId("Casey", "casey@acme.test");
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });

    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    await expect(bcrypt.compare("", user.passwordHash)).resolves.toBe(false);
    await expect(bcrypt.compare("password", user.passwordHash)).resolves.toBe(false);
  });

  it("leaves the guest row unverified so it cannot log in", async () => {
    const id = await resolveGuestRequesterId("Casey", "casey@acme.test");
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.emailVerifiedAt).toBeNull();
  });
});

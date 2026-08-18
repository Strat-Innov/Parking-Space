import { prisma } from "./prisma";
import { unusablePasswordHash } from "./password";

// Shared by both public intake forms (/requests/new and /access/new) — an
// anonymous submission gets a lightweight "guest" User row (found-or-created
// by email) with an unusable random password hash: they were never meant to
// log back in as it, only to have submitted the request at all. This
// mirrors BR-003/BR-004 — once submitted, the requester has no further
// access, loop or otherwise.
export async function resolveGuestRequesterId(fullName: string, emailAddress: string) {
  const email = emailAddress.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing.id;

  const created = await prisma.user.create({
    data: { name: fullName, email, role: "REQUESTER", passwordHash: await unusablePasswordHash() },
  });
  return created.id;
}

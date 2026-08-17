import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getSession, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitRequest } from "@/lib/workflows";
import { handleApiError } from "@/lib/api-helpers";
import { intakeFieldsSchema } from "@/lib/validation";

// Every login-capable role (Prepared By, Validated By, Cashier, Parking
// Management) sees every request — only their dashboard's actionable
// filtering differs. Requestors never log in, so there's no self-scoped view.
export async function GET() {
  try {
    await requireSession();

    const requests = await prisma.parkingRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: { requester: { select: { name: true, email: true } } },
    });
    return NextResponse.json({ requests });
  } catch (err) {
    return handleApiError(err);
  }
}

// The submission form (/requests/new) is public — it's what a QR code
// points an external company at, and they have no account. Since
// ParkingRequest.requesterId is a required foreign key, an anonymous
// submission gets a lightweight "guest" User row created (or reused, by
// email) with an unusable random password hash: they were never meant to
// log back in as it, only to have submitted the request at all. This
// mirrors BR-003/BR-004 — once submitted, the requester has no further
// access, loop or otherwise.
async function resolveGuestRequesterId(fullName: string, emailAddress: string) {
  const email = emailAddress.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing.id;

  const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  const created = await prisma.user.create({
    data: { name: fullName, email, role: "REQUESTER", passwordHash: unusablePasswordHash },
  });
  return created.id;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (session) {
      return NextResponse.json({ error: "Submit a new parking request via the public request form." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = intakeFieldsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const requesterId = await resolveGuestRequesterId(parsed.data.fullName, parsed.data.emailAddress);

    const created = await submitRequest(parsed.data, requesterId);
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

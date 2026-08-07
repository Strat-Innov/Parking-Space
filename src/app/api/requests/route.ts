import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getSession, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitRequest } from "@/lib/workflows";
import { handleApiError } from "@/lib/api-helpers";
import { SERVICE_TYPES } from "@/lib/types";

const createSchema = z.object({
  companyName: z.string().min(1),
  emailAddress: z.string().email(),
  serviceType: z.enum(SERVICE_TYPES),
  preferredParkingLocation: z.string().min(1),
  requiredStartDate: z.coerce.date(),
  endDate: z.coerce.date(),
  purpose: z.string().min(1),
});

// Role-scoped list: each role only sees the requests relevant to its queue,
// keeping "who should be looking at what" out of the client entirely.
export async function GET() {
  try {
    const session = await requireSession();

    const where =
      session.role === "REQUESTER"
        ? { requesterId: session.sub }
        : session.role === "PREPARED_BY"
        ? {}
        : session.role === "VALIDATED_BY"
        ? {}
        : session.role === "CASHIER"
        ? {}
        : {}; // PARKING_MANAGEMENT

    const requests = await prisma.parkingRequest.findMany({
      where,
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
async function resolveGuestRequesterId(companyName: string, emailAddress: string) {
  const email = emailAddress.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing.id;

  const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  const created = await prisma.user.create({
    data: { name: companyName, email, role: "REQUESTER", passwordHash: unusablePasswordHash },
  });
  return created.id;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (session && session.role !== "REQUESTER") {
      return NextResponse.json({ error: "Only requesters can submit a new parking request." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const requesterId = session
      ? session.sub
      : await resolveGuestRequesterId(parsed.data.companyName, parsed.data.emailAddress);

    const created = await submitRequest(parsed.data, requesterId);
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

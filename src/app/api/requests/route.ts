import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
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

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (session.role !== "REQUESTER") {
      return NextResponse.json({ error: "Only requesters can submit a new parking request." }, { status: 403 });
    }
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }
    const created = await submitRequest(parsed.data, session.sub);
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

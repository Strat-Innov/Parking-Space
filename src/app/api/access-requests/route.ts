import { NextRequest, NextResponse } from "next/server";
import { getSession, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitAccessRequest } from "@/lib/access-workflows";
import { handleApiError } from "@/lib/api-helpers";
import { accessIntakeFieldsSchema } from "@/lib/access-validation";
import { resolveGuestRequesterId } from "@/lib/guest";

// Every login-capable role sees every access request — same pattern as
// GET /api/requests, only the access dashboard's actionable filtering
// (Parking Management only) differs.
export async function GET() {
  try {
    await requireSession();
    const requests = await prisma.accessRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: { requester: { select: { name: true, email: true } } },
    });
    return NextResponse.json({ requests });
  } catch (err) {
    return handleApiError(err);
  }
}

// /access/new is public, same as /requests/new — no logged-in account can
// submit through this route either.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (session) {
      return NextResponse.json(
        { error: "You're logged in as staff — log out (or use a private window) to submit as a guest requestor." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = accessIntakeFieldsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const requesterId = await resolveGuestRequesterId(parsed.data.fullName, parsed.data.emailAddress);
    const created = await submitAccessRequest(parsed.data, requesterId);
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

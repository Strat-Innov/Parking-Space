import { NextRequest, NextResponse } from "next/server";
import { getSession, requireSession } from "@/lib/auth";
import { repos } from "@/lib/data";
import { submitRequest } from "@/lib/workflows";
import { handleApiError } from "@/lib/api-helpers";
import { intakeFieldsSchema } from "@/lib/validation";
import { resolveGuestRequesterId } from "@/lib/guest";

// Every login-capable role (Prepared By, Validated By, Cashier, Parking
// Management) sees every request — only their dashboard's actionable
// filtering differs. Requestors never log in, so there's no self-scoped view.
export async function GET() {
  try {
    await requireSession();

    const requests = await repos.parkingRequests.listAllWithRequesterContact();
    return NextResponse.json({ requests });
  } catch (err) {
    return handleApiError(err);
  }
}

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

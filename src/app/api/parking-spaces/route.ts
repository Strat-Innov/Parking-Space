import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, requireSession } from "@/lib/auth";
import { repos } from "@/lib/data";
import { handleApiError } from "@/lib/api-helpers";

// Same maintenance access as the Rate Table (Section 7): Parking Management,
// Prepared By, and Validated By can all add or remove a parking space.
// DEVELOPER also gets add access (not just the hard-delete capability in
// [id]/delete/route.ts) so cleanup work doesn't require switching accounts.
const MAINTAINERS = ["PARKING_MANAGEMENT", "PREPARED_BY", "VALIDATED_BY", "DEVELOPER"] as const;

const createSchema = z.object({
  location: z.string().min(1),
  slotNumber: z.string().min(1),
});

export async function GET() {
  try {
    await requireSession();
    const spaces = await repos.parkingSpaces.listAll();
    return NextResponse.json({ spaces });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(...MAINTAINERS);
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const duplicate = await repos.parkingSpaces.findActiveByLocationAndSlot(
      parsed.data.location,
      parsed.data.slotNumber,
    );
    if (duplicate) {
      return NextResponse.json({ error: "That location/slot combination is already in the list." }, { status: 409 });
    }

    const space = await repos.parkingSpaces.create({ ...parsed.data, createdById: session.sub });
    return NextResponse.json({ space }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { repos } from "@/lib/data";
import { handleApiError } from "@/lib/api-helpers";
import { WorkflowError } from "@/lib/workflows";

const MAINTAINERS = ["PARKING_MANAGEMENT", "PREPARED_BY", "VALIDATED_BY", "DEVELOPER"] as const;

// Soft delete — never hard-removed, so a past request's parkingSpaceId stays
// valid. Blocked if the space has a current or upcoming booking; a space
// that's only ever been booked in the past is fine to remove.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(...MAINTAINERS);
    const { id } = await params;

    const space = await repos.parkingSpaces.findById(id);
    if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!space.isActive) return NextResponse.json({ space });

    const now = new Date();
    const upcomingBooking = await repos.parkingRequests.findUpcomingBookingForSpace(id, now);
    if (upcomingBooking) {
      throw new WorkflowError("Can't remove — this space has a current or upcoming booking.", 409);
    }

    const updated = await repos.parkingSpaces.update(id, { isActive: false });
    return NextResponse.json({ space: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

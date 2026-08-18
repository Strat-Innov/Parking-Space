import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";

// Developer-only, permanent — distinct from the normal soft "remove" (which
// only flips isActive false and keeps the row, so any past request's
// parkingSpaceId stays valid). This actually deletes the row, so it's
// blocked if ANY request — past or present — ever referenced this space;
// that FK has no cascade, so this would otherwise just throw a raw
// constraint error.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("DEVELOPER");
    const { id } = await params;

    const space = await prisma.parkingSpace.findUnique({ where: { id } });
    if (!space) return NextResponse.json({ error: "Parking space not found." }, { status: 404 });

    const inUse = await prisma.parkingRequest.count({ where: { parkingSpaceId: id } });
    if (inUse > 0) {
      return NextResponse.json(
        { error: `Can't delete — ${inUse} request(s) reference this space, including past ones. Use Remove instead.` },
        { status: 409 },
      );
    }

    await prisma.parkingSpace.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";

// Developer-only, permanent — the one exception to Rate Table's normal
// append-only rule (Section 7). Blocked if any request ever snapshotted
// this exact version (ParkingRequest.rateVersionId), since that's the
// request's recorded historical rate and must never change out from under
// it; that FK has no cascade, so this would otherwise just throw a raw
// constraint error.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("DEVELOPER");
    const { id } = await params;

    const entry = await prisma.rateTableEntry.findUnique({ where: { id } });
    if (!entry) return NextResponse.json({ error: "Rate entry not found." }, { status: 404 });

    const inUse = await prisma.parkingRequest.count({ where: { rateVersionId: id } });
    if (inUse > 0) {
      return NextResponse.json(
        { error: `Can't delete — ${inUse} request(s) snapshotted this rate version.` },
        { status: 409 },
      );
    }

    await prisma.rateTableEntry.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";

// Developer-only, permanent. Unlike Cancel (which just sets Status =
// Cancelled and keeps the row for the audit trail), this actually removes
// the request. Safe to hard-delete unconditionally — a request's own
// RequestEvent rows are the only thing that reference it (checked
// schema.prisma), so deleting them first and then the request can't orphan
// or corrupt anything else.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("DEVELOPER");
    const { id } = await params;

    const request = await prisma.parkingRequest.findUnique({ where: { id } });
    if (!request) return NextResponse.json({ error: "Request not found." }, { status: 404 });

    await prisma.$transaction([
      prisma.requestEvent.deleteMany({ where: { requestId: id } }),
      prisma.parkingRequest.delete({ where: { id } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

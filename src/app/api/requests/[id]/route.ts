import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const request = await prisma.parkingRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { name: true, email: true } },
        preparedBy: { select: { name: true } },
        validatedBy: { select: { name: true } },
        rejectedBy: { select: { name: true } },
        cashier: { select: { name: true } },
        assignedBy: { select: { name: true } },
        rateVersion: true,
        events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true, role: true } } } },
      },
    });
    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (session.role === "REQUESTER" && request.requesterId !== session.sub) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ request });
  } catch (err) {
    return handleApiError(err);
  }
}

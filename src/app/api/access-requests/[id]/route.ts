import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireSession();
    const request = await prisma.accessRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { name: true, email: true } },
        processedBy: { select: { name: true } },
        completedBy: { select: { name: true } },
        cancelledBy: { select: { name: true } },
        events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true, role: true } } } },
      },
    });
    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ request });
  } catch (err) {
    return handleApiError(err);
  }
}

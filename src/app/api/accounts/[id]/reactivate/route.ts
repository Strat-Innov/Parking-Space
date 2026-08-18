import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("DEVELOPER");
    const { id } = await params;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    await prisma.user.update({ where: { id }, data: { active: true } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

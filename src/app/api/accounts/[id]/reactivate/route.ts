import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { repos } from "@/lib/data";
import { handleApiError } from "@/lib/api-helpers";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("DEVELOPER");
    const { id } = await params;

    const user = await repos.users.findById(id);
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    await repos.users.update(id, { active: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

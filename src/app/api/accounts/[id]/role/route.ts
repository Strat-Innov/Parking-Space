import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";
import { ASSIGNABLE_ROLES } from "@/lib/types";

const schema = z.object({ role: z.enum(ASSIGNABLE_ROLES) });

// Developer-only. Self-edit is blocked for the same reason as
// deactivate/delete on your own account — a misclick here (e.g. demoting
// yourself out of Developer) could lock you out of the one role that can
// undo it. If you're the only Developer and need to change your own role,
// that still needs a direct DB update.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("DEVELOPER");
    const { id } = await params;
    if (id === actor.sub) {
      return NextResponse.json({ error: "You can't change your own role here." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const updated = await prisma.user.update({
      where: { id },
      data: { role: parsed.data.role },
      select: { id: true, name: true, email: true, role: true },
    });
    return NextResponse.json({ account: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

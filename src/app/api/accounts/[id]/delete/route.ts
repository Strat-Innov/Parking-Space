import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";
import { accountHasHistory } from "@/lib/accountDeletion";

// Developer-only, permanent. Unlike deactivate, this actually removes the
// row — only allowed for accounts with zero history (see accountHasHistory)
// so it can never silently orphan or corrupt a past request/approval/audit
// trail. Anything with real history stays on deactivate.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("DEVELOPER");
    const { id } = await params;
    if (id === actor.sub) {
      return NextResponse.json({ error: "You can't delete your own account." }, { status: 403 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    if (await accountHasHistory(id)) {
      return NextResponse.json(
        { error: "This account has request history and can't be permanently deleted — use Deactivate instead." },
        { status: 409 },
      );
    }

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";
import { getAccountHistoryBreakdown, describeAccountHistory } from "@/lib/accountDeletion";

// Developer-only, permanent. Unlike deactivate, this actually removes the
// row — only allowed for accounts with zero history (see
// getAccountHistoryBreakdown) so it can never silently orphan or corrupt a
// past request/approval/audit trail. Anything with real history stays on
// deactivate; the error names exactly what's still attached so it's never a
// mystery why deletion was refused.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("DEVELOPER");
    const { id } = await params;
    if (id === actor.sub) {
      return NextResponse.json({ error: "You can't delete your own account." }, { status: 403 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const breakdown = await getAccountHistoryBreakdown(id);
    const description = describeAccountHistory(breakdown);
    if (description) {
      return NextResponse.json(
        { error: `This account can't be permanently deleted — it still has: ${description}. Use Deactivate instead.` },
        { status: 409 },
      );
    }

    // rateTableEntries/parkingSpaces createdBy is attribution only, not a
    // workflow dependency (see accountDeletion.ts) — null it out rather
    // than block the delete on it.
    await prisma.$transaction([
      prisma.rateTableEntry.updateMany({ where: { createdById: id }, data: { createdById: null } }),
      prisma.parkingSpace.updateMany({ where: { createdById: id }, data: { createdById: null } }),
      prisma.user.delete({ where: { id } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

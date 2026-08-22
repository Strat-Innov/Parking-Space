import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { repos } from "@/lib/data";
import { handleApiError } from "@/lib/api-helpers";

// Developer-only (unlike add/invite, which stays open to any staff member).
// Disables login without deleting the row — every request/event this
// account is attached to stays intact.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("DEVELOPER");
    const { id } = await params;
    if (id === actor.sub) {
      return NextResponse.json({ error: "You can't deactivate your own account." }, { status: 403 });
    }

    const user = await repos.users.findById(id);
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    await repos.users.update(id, { active: false });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { repos } from "@/lib/data";
import { handleApiError } from "@/lib/api-helpers";
import { ASSIGNABLE_ROLES } from "@/lib/types";

// Developer is exclusive: it already has its own full admin reach, so it's
// never combined with the 3 workflow roles (enforced here in addition to
// the client-side toggle logic in EditRoleAction).
const schema = z.object({ roles: z.array(z.enum(ASSIGNABLE_ROLES)).min(1) });

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

    const roles = Array.from(new Set(parsed.data.roles));
    if (roles.includes("DEVELOPER") && roles.length > 1) {
      return NextResponse.json({ error: "Developer can't be combined with other roles." }, { status: 422 });
    }

    const user = await repos.users.findById(id);
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const updated = await repos.users.updateRoles(id, roles[0], roles);
    return NextResponse.json({ account: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

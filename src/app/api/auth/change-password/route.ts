import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth";
import { repos } from "@/lib/data";
import { handleApiError } from "@/lib/api-helpers";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const user = await repos.users.findByIdOrThrow(session.sub);
    const currentOk = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!currentOk) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await repos.users.update(session.sub, { passwordHash });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

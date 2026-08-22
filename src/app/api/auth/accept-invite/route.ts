import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { repos } from "@/lib/data";
import { handleApiError } from "@/lib/api-helpers";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const user = await repos.users.findByVerificationToken(parsed.data.token);
    if (
      !user ||
      user.hasPassword ||
      user.emailVerifiedAt ||
      !user.emailVerificationTokenExpiresAt ||
      user.emailVerificationTokenExpiresAt < new Date()
    ) {
      return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 404 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    await repos.users.update(user.id, {
      passwordHash,
      hasPassword: true,
      emailVerifiedAt: new Date(),
      emailVerificationToken: null,
      emailVerificationTokenExpiresAt: null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

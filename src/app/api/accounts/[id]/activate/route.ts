import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";

// Manual fallback for when email delivery isn't available (e.g. sending
// domain can't be DNS-verified yet) — a staff member vouches for the
// account in person instead of the person clicking an emailed link.
//
// Two cases, since a pending account can be stuck for two different
// reasons:
// - Self-signup, unconfirmed (hasPassword true): they already chose a real
//   password at /signup, just never clicked the confirm link. Activating
//   only needs to set emailVerifiedAt.
// - Invited, not accepted (hasPassword false): passwordHash is still the
//   unusable placeholder from /api/accounts/invite — there's no password to
//   fall back to, so activating here requires the staff member to set one
//   (communicated to the person some other way, e.g. Teams/phone).
const schema = z.object({ password: z.string().min(8, "Password must be at least 8 characters.").optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    if (user.emailVerifiedAt) return NextResponse.json({ error: "This account is already active." }, { status: 409 });

    if (!user.hasPassword) {
      if (!parsed.data.password) {
        return NextResponse.json({ error: "This account was invited and has no password yet — set one to activate it." }, { status: 422 });
      }
      await prisma.user.update({
        where: { id },
        data: {
          passwordHash: await bcrypt.hash(parsed.data.password, 10),
          hasPassword: true,
          emailVerifiedAt: new Date(),
          emailVerificationToken: null,
          emailVerificationTokenExpiresAt: null,
        },
      });
    } else {
      await prisma.user.update({
        where: { id },
        data: { emailVerifiedAt: new Date(), emailVerificationToken: null, emailVerificationTokenExpiresAt: null },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

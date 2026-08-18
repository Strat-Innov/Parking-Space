import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";
import { isEmailDomainAllowedForSignup } from "@/lib/signup";
import { createVerificationToken, buildConfirmUrl } from "@/lib/emailVerification";
import { sendConfirmationEmail } from "@/lib/email";

// Public, no session required. Domain-gated: only email addresses on the
// allowlist (see src/lib/signup.ts) can self-service create an account, and
// they always land as Prepared By — the least-privileged staff role. Higher
// roles are only ever granted via the staff-only Add Account flow at
// /api/accounts, which requires an existing session.
const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const email = parsed.data.email.toLowerCase();
    if (!isEmailDomainAllowedForSignup(email)) {
      return NextResponse.json(
        { error: "This email domain isn't eligible for self-service signup. Ask a colleague to add your account instead." },
        { status: 403 },
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const { token, expiresAt } = createVerificationToken();
    await prisma.user.create({
      data: {
        name: parsed.data.name,
        email,
        role: "PREPARED_BY",
        passwordHash,
        emailVerificationToken: token,
        emailVerificationTokenExpiresAt: expiresAt,
      },
    });

    try {
      await sendConfirmationEmail(email, parsed.data.name, buildConfirmUrl(token));
    } catch (err) {
      // Account exists but the email didn't go out — don't fail the signup
      // (the row is already created), but surface it so the user isn't left
      // silently stuck. They can retry via /api/auth/resend-confirmation.
      console.error("Failed to send confirmation email:", err);
      return NextResponse.json(
        { error: "Account created, but the confirmation email failed to send. Use \"Resend confirmation email\" on the login page." },
        { status: 201 },
      );
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

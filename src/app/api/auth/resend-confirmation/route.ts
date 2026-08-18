import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";
import { createVerificationToken, buildConfirmUrl } from "@/lib/emailVerification";
import { sendConfirmationEmail } from "@/lib/email";

const schema = z.object({ email: z.string().email() });

// Always responds with the same generic message regardless of whether the
// account exists or is already confirmed — avoids leaking which emails have
// accounts (user enumeration).
const GENERIC_OK = { ok: true, message: "If that email has a pending confirmation, we've sent a new link." };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "A valid email is required." }, { status: 422 });
    }

    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) {
      return NextResponse.json(GENERIC_OK);
    }

    const { token, expiresAt } = createVerificationToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: token, emailVerificationTokenExpiresAt: expiresAt },
    });
    await sendConfirmationEmail(email, user.name, buildConfirmUrl(token));

    return NextResponse.json(GENERIC_OK);
  } catch (err) {
    return handleApiError(err);
  }
}

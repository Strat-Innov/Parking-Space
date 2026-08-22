import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { repos } from "@/lib/data";
import { handleApiError } from "@/lib/api-helpers";
import { createVerificationToken, createInviteToken, buildConfirmUrl, buildAcceptInviteUrl } from "@/lib/emailVerification";
import { sendConfirmationEmail, sendInviteEmail } from "@/lib/email";
import type { Role } from "@/lib/types";

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
    const user = await repos.users.findByEmail(email);
    if (!user || user.emailVerifiedAt) {
      return NextResponse.json(GENERIC_OK);
    }

    // Invited-but-not-accepted accounts (hasPassword false) need a fresh
    // invite link, not a confirm link — a confirm link would mark them
    // verified without ever collecting a real password, permanently
    // stranding the account (see schema.prisma comment on hasPassword).
    if (user.hasPassword) {
      const { token, expiresAt } = createVerificationToken();
      await repos.users.update(user.id, {
        emailVerificationToken: token,
        emailVerificationTokenExpiresAt: expiresAt,
      });
      await sendConfirmationEmail(email, user.name, buildConfirmUrl(token));
    } else {
      const { token, expiresAt } = createInviteToken();
      await repos.users.update(user.id, {
        emailVerificationToken: token,
        emailVerificationTokenExpiresAt: expiresAt,
      });
      await sendInviteEmail(email, user.name, user.role as Role, buildAcceptInviteUrl(token));
    }

    return NextResponse.json(GENERIC_OK);
  } catch (err) {
    return handleApiError(err);
  }
}

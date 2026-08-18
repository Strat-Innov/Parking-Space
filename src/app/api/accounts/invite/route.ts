import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";
import { STAFF_ROLES } from "@/lib/types";
import { createInviteToken, buildAcceptInviteUrl } from "@/lib/emailVerification";
import { sendInviteEmail } from "@/lib/email";
import { unusablePasswordHash } from "@/lib/password";

// Staff-only bulk invite: rather than the inviter choosing a password (the
// existing /api/accounts flow), each invitee gets an emailed link to set
// their own password — see src/app/accept-invite/page.tsx. Same trust model
// as the direct-create flow (any logged-in staff member, any staff role),
// so unlike public /signup there's no domain gate and no role restriction.
const inviteSchema = z.object({
  invites: z
    .array(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        role: z.enum(STAFF_ROLES),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const results = await Promise.all(
      parsed.data.invites.map(async (invite) => {
        const email = invite.email.toLowerCase();
        try {
          const existing = await prisma.user.findUnique({ where: { email } });
          if (existing) {
            return { email, status: "skipped" as const, reason: "An account with this email already exists." };
          }

          const { token, expiresAt } = createInviteToken();
          await prisma.user.create({
            data: {
              name: invite.name,
              email,
              role: invite.role,
              passwordHash: await unusablePasswordHash(),
              hasPassword: false,
              emailVerificationToken: token,
              emailVerificationTokenExpiresAt: expiresAt,
            },
          });
          await sendInviteEmail(email, invite.name, invite.role, buildAcceptInviteUrl(token));
          return { email, status: "sent" as const };
        } catch (err) {
          console.error(`Failed to invite ${email}:`, err);
          return { email, status: "failed" as const, reason: "Something went wrong sending this invite." };
        }
      }),
    );

    return NextResponse.json({ results });
  } catch (err) {
    return handleApiError(err);
  }
}

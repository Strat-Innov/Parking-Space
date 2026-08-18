import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";
import { ROLE_LABELS, type Role } from "@/lib/types";

// Public — reachable only by whoever holds the token (from the invite
// email), used by /accept-invite to show who's being set up before they
// commit to a password.
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } });
    if (
      !user ||
      user.hasPassword ||
      user.emailVerifiedAt ||
      !user.emailVerificationTokenExpiresAt ||
      user.emailVerificationTokenExpiresAt < new Date()
    ) {
      return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 404 });
    }

    return NextResponse.json({
      name: user.name,
      email: user.email,
      roleLabel: ROLE_LABELS[user.role as Role] ?? user.role,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

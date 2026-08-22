import { NextRequest, NextResponse } from "next/server";
import { repos } from "@/lib/data";
import { getAppUrl } from "@/lib/url";

// Visited directly from the link in the confirmation email — a GET with a
// side effect is the standard pattern for this (the token itself is the
// single-use bearer credential authorizing the mutation).
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const loginUrl = new URL("/login", getAppUrl());

  if (!token) {
    loginUrl.searchParams.set("verifyError", "missing");
    return NextResponse.redirect(loginUrl);
  }

  const user = await repos.users.findByVerificationToken(token);
  // hasPassword false means this is actually an invite token (see
  // schema.prisma) — those are consumed at /accept-invite, which also sets
  // a real password. Confirming here without one would strand the account.
  if (!user || !user.hasPassword || !user.emailVerificationTokenExpiresAt || user.emailVerificationTokenExpiresAt < new Date()) {
    loginUrl.searchParams.set("verifyError", "invalid");
    return NextResponse.redirect(loginUrl);
  }

  await repos.users.update(user.id, {
    emailVerifiedAt: new Date(),
    emailVerificationToken: null,
    emailVerificationTokenExpiresAt: null,
  });

  loginUrl.searchParams.set("verified", "1");
  return NextResponse.redirect(loginUrl);
}

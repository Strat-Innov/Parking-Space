import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

  const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } });
  if (!user || !user.emailVerificationTokenExpiresAt || user.emailVerificationTokenExpiresAt < new Date()) {
    loginUrl.searchParams.set("verifyError", "invalid");
    return NextResponse.redirect(loginUrl);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), emailVerificationToken: null, emailVerificationTokenExpiresAt: null },
  });

  loginUrl.searchParams.set("verified", "1");
  return NextResponse.redirect(loginUrl);
}

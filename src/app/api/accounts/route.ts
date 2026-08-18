import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";
import { ASSIGNABLE_ROLES } from "@/lib/types";

// Any logged-in staff member (any of the 3 staff roles) may add a new staff
// account — there's no separate "admin" role in this app, so this is
// intentionally not gated beyond requireSession(). DEVELOPER is the one
// exception: it's a deliberate, sensitive elevation, so only an existing
// Developer can grant it (checked below, after parsing — zod alone can't
// see who the actor is).
const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  role: z.enum(ASSIGNABLE_ROLES),
});

export async function GET() {
  try {
    await requireSession();
    const accounts = await prisma.user.findMany({
      where: { role: { in: ASSIGNABLE_ROLES as unknown as string[] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    return NextResponse.json({ accounts });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }
    if (parsed.data.role === "DEVELOPER" && actor.role !== "DEVELOPER") {
      return NextResponse.json({ error: "Only a Developer can grant the Developer role." }, { status: 403 });
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    // Vouched for by the staff member adding them (requireSession above) —
    // unlike self-service /signup, no separate email confirmation step.
    const account = await prisma.user.create({
      data: { name: parsed.data.name, email, role: parsed.data.role, passwordHash, emailVerifiedAt: new Date() },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

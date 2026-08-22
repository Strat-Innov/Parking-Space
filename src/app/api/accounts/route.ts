import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireSession, requireRole } from "@/lib/auth";
import { repos } from "@/lib/data";
import { handleApiError } from "@/lib/api-helpers";
import { ASSIGNABLE_ROLES } from "@/lib/types";

// Account creation is Developer-only.
const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  role: z.enum(ASSIGNABLE_ROLES),
});

export async function GET() {
  try {
    await requireSession();
    const accounts = await repos.users.listSummariesByRoles(ASSIGNABLE_ROLES);
    return NextResponse.json({ accounts });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole("DEVELOPER");
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await repos.users.findByEmail(email);
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    // Vouched for by the Developer adding them (requireRole above) — unlike
    // self-service /signup, no separate email confirmation step.
    const created = await repos.users.create({
      name: parsed.data.name,
      email,
      role: parsed.data.role,
      passwordHash,
      emailVerifiedAt: new Date(),
    });
    // Projected explicitly: the response has always carried these five fields
    // and must never widen to the whole user row (which holds passwordHash).
    const account = {
      id: created.id,
      name: created.name,
      email: created.email,
      role: created.role,
      createdAt: created.createdAt,
    };
    return NextResponse.json({ account }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

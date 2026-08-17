import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession, verifyCredentials } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import type { Role } from "@/lib/types";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 422 });
    }

    const user = await verifyCredentials(parsed.data.email, parsed.data.password);
    if (!user) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }
    // Requestors never log in — submission is the public /requests/new form
    // (BR-003: once submitted, the requester has no further access). Cashier
    // is retired — WF04 payment confirmation moved to Prepared By, an
    // inline field edit rather than a separate role/action.
    if (user.role === "REQUESTER" || user.role === "CASHIER") {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    await createSession({ sub: user.id, role: user.role as Role, name: user.name, email: user.email });
    return NextResponse.json({ ok: true, role: user.role });
  } catch (err) {
    return handleApiError(err);
  }
}

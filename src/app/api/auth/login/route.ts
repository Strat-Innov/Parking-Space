import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession, verifyCredentials } from "@/lib/auth";
import { handleApiError } from "@/lib/api-helpers";
import type { Role } from "@/lib/types";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Only required when the account holds more than one role — see the
  // multiRole response below. Omitted on the first attempt.
  selectedRole: z.string().optional(),
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
    if (!user.emailVerifiedAt) {
      return NextResponse.json(
        { error: "Please confirm your email address before signing in.", unconfirmed: true },
        { status: 403 },
      );
    }
    if (!user.active) {
      return NextResponse.json({ error: "This account has been deactivated." }, { status: 403 });
    }

    // Multi-role workaround (see schema.prisma's comment on User.roles): a
    // session still only ever activates ONE role, so this is the only place
    // that needs to know about the plural set. Falls back to [role] for any
    // account that predates this field.
    const availableRoles = user.roles.length > 0 ? user.roles : [user.role];

    let activeRole: string;
    if (availableRoles.length > 1) {
      if (!parsed.data.selectedRole) {
        // Password already verified above — don't ask for it again, just
        // ask which role. The client resubmits the same credentials plus
        // this choice.
        return NextResponse.json({ multiRole: true, roles: availableRoles });
      }
      if (!availableRoles.includes(parsed.data.selectedRole)) {
        return NextResponse.json({ error: "Not a role on this account." }, { status: 403 });
      }
      activeRole = parsed.data.selectedRole;
    } else {
      activeRole = availableRoles[0];
    }

    await createSession({ sub: user.id, role: activeRole as Role, name: user.name, email: user.email });
    return NextResponse.json({ ok: true, role: activeRole });
  } catch (err) {
    return handleApiError(err);
  }
}

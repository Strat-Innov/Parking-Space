import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";
import { SERVICE_TYPES } from "@/lib/types";

// Section 7: "Parking Management, Prepared By, and Validated By all have
// edit access to the Rate Table list." DEVELOPER also gets add access here
// (not just the delete capability in [id]/delete/route.ts) so cleanup work
// doesn't require switching accounts.
const MAINTAINERS = ["PARKING_MANAGEMENT", "PREPARED_BY", "VALIDATED_BY", "DEVELOPER"] as const;

const createSchema = z.object({
  serviceType: z.enum(SERVICE_TYPES),
  chargingModel: z.string().min(1),
  rateAmount: z.coerce.number().positive(),
  effectiveStartDate: z.coerce.date(),
});

export async function GET() {
  try {
    await requireSession();
    const entries = await prisma.rateTableEntry.findMany({
      orderBy: [{ serviceType: "asc" }, { effectiveStartDate: "desc" }],
      include: { createdBy: { select: { name: true } } },
    });
    return NextResponse.json({ entries });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(...MAINTAINERS);
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }
    // Append-only: this is always an INSERT, never an UPDATE of an existing row.
    const entry = await prisma.rateTableEntry.create({
      data: { ...parsed.data, createdById: session.sub },
    });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

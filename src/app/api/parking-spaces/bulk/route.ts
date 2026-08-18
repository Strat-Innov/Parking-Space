import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";

const MAINTAINERS = ["PARKING_MANAGEMENT", "PREPARED_BY", "VALIDATED_BY", "DEVELOPER"] as const;

const bulkSchema = z.object({
  location: z.string().min(1),
  slotNumbers: z.array(z.string().min(1)).min(1),
});

// One location, many slot numbers at once — skips any that already exist
// (active) for that location rather than failing the whole batch.
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(...MAINTAINERS);
    const body = await req.json().catch(() => null);
    const parsed = bulkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }

    const { location } = parsed.data;
    const requested = Array.from(new Set(parsed.data.slotNumbers.map((s) => s.trim()).filter(Boolean)));

    const existing = await prisma.parkingSpace.findMany({
      where: { location, slotNumber: { in: requested }, isActive: true },
      select: { slotNumber: true },
    });
    const existingSet = new Set(existing.map((e) => e.slotNumber));
    const toCreate = requested.filter((s) => !existingSet.has(s));

    if (toCreate.length > 0) {
      await prisma.parkingSpace.createMany({
        data: toCreate.map((slotNumber) => ({ location, slotNumber, createdById: session.sub })),
      });
    }

    return NextResponse.json(
      { created: toCreate.length, skipped: requested.filter((s) => existingSet.has(s)) },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}

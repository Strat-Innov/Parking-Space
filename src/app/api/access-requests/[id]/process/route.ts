import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { processAccessRequest } from "@/lib/access-workflows";
import { handleApiError } from "@/lib/api-helpers";

const schema = z.object({
  confirmedQuantity: z.coerce.number().int().positive(),
  accessSeriesRef: z.string().min(1),
  purchasedCharge: z.coerce.number().nonnegative(),
  officialReceiptRef: z.string().min(1),
  staffRemarks: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }
    const updated = await processAccessRequest(id, session, parsed.data);
    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

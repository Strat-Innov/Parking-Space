import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { wf04ConfirmPayment } from "@/lib/workflows";
import { handleApiError } from "@/lib/api-helpers";

const schema = z.object({
  officialReceiptReference: z.string().min(1),
  payDate: z.coerce.date(),
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
    const updated = await wf04ConfirmPayment(id, session, parsed.data.officialReceiptReference, parsed.data.payDate);
    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

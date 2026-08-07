import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { wf04ConfirmPayment, wf04StartPayment } from "@/lib/workflows";
import { handleApiError } from "@/lib/api-helpers";

const schema = z.object({
  action: z.enum(["start", "confirm"]),
  officialReceiptReference: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "action must be 'start' or 'confirm'." }, { status: 422 });
    }
    const updated =
      parsed.data.action === "start"
        ? await wf04StartPayment(id, session)
        : await wf04ConfirmPayment(id, session, parsed.data.officialReceiptReference ?? "");
    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

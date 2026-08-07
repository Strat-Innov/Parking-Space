import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { wf03Decide } from "@/lib/workflows";
import { handleApiError } from "@/lib/api-helpers";

const schema = z.object({
  decision: z.enum(["Approved", "Rejected"]),
  rejectionReason: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "decision must be 'Approved' or 'Rejected'." }, { status: 422 });
    }
    const updated = await wf03Decide(id, session, parsed.data.decision, parsed.data.rejectionReason);
    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { wf05AssignSlot } from "@/lib/workflows";
import { handleApiError } from "@/lib/api-helpers";

const schema = z.object({ assignedSlot: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "assignedSlot is required." }, { status: 422 });
    }
    const updated = await wf05AssignSlot(id, session, parsed.data.assignedSlot);
    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

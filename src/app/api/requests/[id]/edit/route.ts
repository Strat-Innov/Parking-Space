import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { updateRequestDetails } from "@/lib/workflows";
import { handleApiError } from "@/lib/api-helpers";
import { intakeFieldsSchema } from "@/lib/validation";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = intakeFieldsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }
    const updated = await updateRequestDetails(id, session, parsed.data);
    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { completeAccessRequest } from "@/lib/access-workflows";
import { handleApiError } from "@/lib/api-helpers";

const schema = z.object({ receivedByName: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Received By name is required." }, { status: 422 });
    }
    const updated = await completeAccessRequest(id, session, parsed.data.receivedByName);
    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

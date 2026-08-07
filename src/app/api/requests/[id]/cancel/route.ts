import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { cancelRequest } from "@/lib/workflows";
import { handleApiError } from "@/lib/api-helpers";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const updated = await cancelRequest(id, session);
    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

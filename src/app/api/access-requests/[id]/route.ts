import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { repos } from "@/lib/data";
import { handleApiError } from "@/lib/api-helpers";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireSession();
    const request = await repos.accessRequests.findDetailById(id);
    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ request });
  } catch (err) {
    return handleApiError(err);
  }
}

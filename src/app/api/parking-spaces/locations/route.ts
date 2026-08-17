import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-helpers";

// Public — no requireSession(). This feeds the Preferred Parking Location
// dropdown on /requests/new, which has no login (QR-code intake). Exposes
// only distinct active location names, nothing else from the inventory
// (slot numbers, occupancy, who added them).
export async function GET() {
  try {
    const spaces = await prisma.parkingSpace.findMany({
      where: { isActive: true },
      select: { location: true },
      distinct: ["location"],
      orderBy: { location: "asc" },
    });
    return NextResponse.json({ locations: spaces.map((s) => s.location) });
  } catch (err) {
    return handleApiError(err);
  }
}

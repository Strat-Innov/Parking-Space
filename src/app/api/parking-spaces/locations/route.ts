import { NextResponse } from "next/server";
import { repos } from "@/lib/data";
import { handleApiError } from "@/lib/api-helpers";

// Public — no requireSession(). This feeds the Preferred Parking Location
// dropdown on /requests/new, which has no login (QR-code intake). Exposes
// only distinct active location names, nothing else from the inventory
// (slot numbers, occupancy, who added them).
export async function GET() {
  try {
    const locations = await repos.parkingSpaces.listDistinctActiveLocations();
    return NextResponse.json({ locations });
  } catch (err) {
    return handleApiError(err);
  }
}

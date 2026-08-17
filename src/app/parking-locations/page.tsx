import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ParkingSpaceForm from "@/components/ParkingSpaceForm";
import ParkingSpaceList from "@/components/ParkingSpaceList";
import type { Role } from "@/lib/types";

const MAINTAINERS: Role[] = ["PARKING_MANAGEMENT", "PREPARED_BY", "VALIDATED_BY"];

export default async function ParkingLocationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const spaces = await prisma.parkingSpace.findMany({
    orderBy: [{ location: "asc" }, { slotNumber: "asc" }],
    include: { createdBy: { select: { name: true } } },
  });

  // "Occupied now" reflects this instant only — a space is locked for
  // whichever date range it's actually booked (see findLockedSpaceIds in
  // workflows.ts, used when Parking Management picks a space for a specific
  // request), not permanently once ever assigned.
  const now = new Date();
  const currentBookings = await prisma.parkingRequest.findMany({
    where: {
      parkingSpaceId: { not: null },
      slotStatus: "Assigned",
      status: { not: "Cancelled" },
      requiredStartDate: { lte: now },
      endDate: { gte: now },
    },
    select: { parkingSpaceId: true },
  });
  const lockedNow = new Set(currentBookings.map((b) => b.parkingSpaceId));

  const canMaintain = MAINTAINERS.includes(session.role as Role);

  const rows = spaces.map((s) => ({
    id: s.id,
    location: s.location,
    slotNumber: s.slotNumber,
    isActive: s.isActive,
    isLockedNow: lockedNow.has(s.id),
    createdByName: s.createdBy.name,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Parking Location</h1>
        <p className="text-sm text-slate-500">
          The physical space inventory Parking Management assigns from (WF05). A space is only locked for the exact
          date range it&apos;s booked — &quot;Occupied now&quot; just reflects this moment, not a permanent state.
        </p>
      </div>

      {canMaintain && <ParkingSpaceForm />}

      <ParkingSpaceList rows={rows} canMaintain={canMaintain} />
    </div>
  );
}

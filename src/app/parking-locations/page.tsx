import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ParkingSpaceForm from "@/components/ParkingSpaceForm";
import ParkingSpaceList from "@/components/ParkingSpaceList";
import type { Role } from "@/lib/types";

const MAINTAINERS: Role[] = ["PARKING_MANAGEMENT", "PREPARED_BY", "VALIDATED_BY", "DEVELOPER"];

export default async function ParkingLocationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const spaces = await prisma.parkingSpace.findMany({
    orderBy: [{ location: "asc" }, { slotNumber: "asc" }],
    include: { createdBy: { select: { name: true } } },
  });

  // One query for every booking that could still matter (still running or
  // yet to start) — bucketed per space in memory below rather than a
  // per-space query, so this stays one round trip regardless of inventory
  // size. A space is only ever locked for the exact date range it's
  // actually booked, never permanently.
  const now = new Date();
  const relevantBookings = await prisma.parkingRequest.findMany({
    where: {
      parkingSpaceId: { not: null },
      slotStatus: "Assigned",
      status: { not: "Cancelled" },
      endDate: { gte: now },
    },
    select: {
      parkingSpaceId: true,
      companyName: true,
      serviceType: true,
      requiredStartDate: true,
      endDate: true,
    },
    orderBy: { requiredStartDate: "asc" },
  });

  const bookingsBySpace = new Map<string, typeof relevantBookings>();
  for (const b of relevantBookings) {
    const key = b.parkingSpaceId as string;
    const list = bookingsBySpace.get(key);
    if (list) list.push(b);
    else bookingsBySpace.set(key, [b]);
  }

  const canMaintain = MAINTAINERS.includes(session.role as Role);

  const rows = spaces.map((s) => {
    const bookings = bookingsBySpace.get(s.id) ?? [];
    const current = bookings.find((b) => b.requiredStartDate <= now && b.endDate >= now);
    const next = !current ? bookings.find((b) => b.requiredStartDate > now) : undefined;

    return {
      id: s.id,
      location: s.location,
      slotNumber: s.slotNumber,
      isActive: s.isActive,
      isLockedNow: !!current,
      currentBooking: current
        ? { company: current.companyName, serviceType: current.serviceType, until: current.endDate.toISOString() }
        : null,
      nextBooking: next
        ? { company: next.companyName, serviceType: next.serviceType, from: next.requiredStartDate.toISOString() }
        : null,
      createdByName: s.createdBy?.name ?? "—",
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Parking Location</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          The physical space inventory Parking Management assigns from (WF05). A space is only locked for the exact
          date range it&apos;s booked — &quot;Occupied now&quot; just reflects this moment, not a permanent state.
        </p>
      </div>

      {canMaintain && <ParkingSpaceForm />}

      <ParkingSpaceList rows={rows} canMaintain={canMaintain} isDeveloper={session.role === "DEVELOPER"} />
    </div>
  );
}

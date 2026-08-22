import { describe, it, expect } from "vitest";
import { addDays } from "date-fns";
import {
  submitRequest,
  wf02EndorseForValidation,
  wf03Decide,
  wf05AssignSlot,
  findLockedSpaceIds,
} from "@/lib/workflows";
import { prisma } from "../helpers/db";
import { createUser, sessionFor, intake, createRate, createSpace, futureStart } from "../helpers/factories";

// Availability is DERIVED from overlapping bookings, never stored as a flag on
// ParkingSpace. These tests pin that down: they are the guard against a
// SharePoint design "simplifying" it into an IsAssigned column, which would
// silently change the rule from "booked for this window" to "booked forever".
async function approvedWithWindow(start: Date, end: Date) {
  const requester = await createUser("REQUESTER");
  const prepared = await createUser("PREPARED_BY");
  const validated = await createUser("VALIDATED_BY");
  const request = await submitRequest(
    intake({ serviceType: "Daily", requiredStartDate: start, endDate: end }),
    requester.id,
  );
  await wf02EndorseForValidation(request.id, sessionFor(prepared));
  return wf03Decide(request.id, sessionFor(validated), "Approved");
}

describe("derived parking-space availability", () => {
  it("refuses an overlapping booking on the same space (409)", async () => {
    await createRate("Daily", 100);
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    const first = await approvedWithWindow(futureStart(2), futureStart(10));
    await wf05AssignSlot(first.id, sessionFor(manager), space.id);

    const second = await approvedWithWindow(futureStart(5), futureStart(15));
    await expect(wf05AssignSlot(second.id, sessionFor(manager), space.id)).rejects.toMatchObject({
      status: 409,
      message: "That parking space is already booked for an overlapping period.",
    });
  });

  it("allows a non-overlapping later booking on the same space", async () => {
    await createRate("Daily", 100);
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    const first = await approvedWithWindow(futureStart(2), futureStart(5));
    await wf05AssignSlot(first.id, sessionFor(manager), space.id);

    const second = await approvedWithWindow(futureStart(10), futureStart(15));
    const assigned = await wf05AssignSlot(second.id, sessionFor(manager), space.id);

    expect(assigned.slotStatus).toBe("Assigned");
    expect(assigned.parkingSpaceId).toBe(space.id);
  });

  it("treats exactly-adjacent windows as non-overlapping", async () => {
    await createRate("Daily", 100);
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();
    const boundary = futureStart(6);

    const first = await approvedWithWindow(futureStart(2), boundary);
    await wf05AssignSlot(first.id, sessionFor(manager), space.id);

    const second = await approvedWithWindow(boundary, futureStart(9));
    const assigned = await wf05AssignSlot(second.id, sessionFor(manager), space.id);

    expect(assigned.slotStatus).toBe("Assigned");
  });

  it("frees the space when the holding request is Cancelled", async () => {
    await createRate("Daily", 100);
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    const first = await approvedWithWindow(futureStart(2), futureStart(10));
    await wf05AssignSlot(first.id, sessionFor(manager), space.id);
    await prisma.parkingRequest.update({ where: { id: first.id }, data: { status: "Cancelled" } });

    const second = await approvedWithWindow(futureStart(5), futureStart(15));
    const assigned = await wf05AssignSlot(second.id, sessionFor(manager), space.id);

    expect(assigned.slotStatus).toBe("Assigned");
  });

  it("never marks the ParkingSpace row itself as taken", async () => {
    await createRate("Daily", 100);
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    const first = await approvedWithWindow(futureStart(2), futureStart(10));
    await wf05AssignSlot(first.id, sessionFor(manager), space.id);

    const reread = await prisma.parkingSpace.findUniqueOrThrow({ where: { id: space.id } });
    expect(reread.isActive).toBe(true);
    expect(Object.keys(reread)).not.toContain("isAssigned");
  });
});

describe("findLockedSpaceIds", () => {
  it("reports a space locked for an overlapping window", async () => {
    await createRate("Daily", 100);
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    const first = await approvedWithWindow(futureStart(2), futureStart(10));
    await wf05AssignSlot(first.id, sessionFor(manager), space.id);

    const locked = await findLockedSpaceIds(futureStart(5), futureStart(12));
    expect(locked.has(space.id)).toBe(true);
  });

  it("reports it free for a window that does not overlap", async () => {
    await createRate("Daily", 100);
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    const first = await approvedWithWindow(futureStart(2), futureStart(5));
    await wf05AssignSlot(first.id, sessionFor(manager), space.id);

    const locked = await findLockedSpaceIds(futureStart(20), futureStart(25));
    expect(locked.has(space.id)).toBe(false);
  });

  it("excludes the request's own booking via excludeRequestId", async () => {
    await createRate("Daily", 100);
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    const first = await approvedWithWindow(futureStart(2), futureStart(10));
    await wf05AssignSlot(first.id, sessionFor(manager), space.id);

    const withoutExclusion = await findLockedSpaceIds(futureStart(2), futureStart(10));
    const withExclusion = await findLockedSpaceIds(futureStart(2), futureStart(10), first.id);

    expect(withoutExclusion.has(space.id)).toBe(true);
    expect(withExclusion.has(space.id)).toBe(false);
  });

  it("ignores unassigned requests entirely", async () => {
    await createRate("Daily", 100);
    const space = await createSpace();
    await approvedWithWindow(futureStart(2), futureStart(10)); // approved, never assigned

    const locked = await findLockedSpaceIds(futureStart(2), futureStart(10));
    expect(locked.has(space.id)).toBe(false);
    expect(locked.size).toBe(0);
  });

  it("ignores cancelled bookings", async () => {
    await createRate("Daily", 100);
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    const first = await approvedWithWindow(futureStart(2), futureStart(10));
    await wf05AssignSlot(first.id, sessionFor(manager), space.id);
    await prisma.parkingRequest.update({ where: { id: first.id }, data: { status: "Cancelled" } });

    const locked = await findLockedSpaceIds(futureStart(2), futureStart(10));
    expect(locked.has(space.id)).toBe(false);
  });

  it("locks only the booked space, not the whole location", async () => {
    await createRate("Daily", 100);
    const manager = await createUser("PARKING_MANAGEMENT");
    const booked = await createSpace("Tower A", "A-01");
    const free = await createSpace("Tower A", "A-02");

    const first = await approvedWithWindow(futureStart(2), futureStart(10));
    await wf05AssignSlot(first.id, sessionFor(manager), booked.id);

    const locked = await findLockedSpaceIds(futureStart(3), futureStart(8));
    expect(locked.has(booked.id)).toBe(true);
    expect(locked.has(free.id)).toBe(false);
  });

  it("returns an empty set when nothing is booked", async () => {
    await createSpace();
    const locked = await findLockedSpaceIds(futureStart(2), addDays(futureStart(2), 3));
    expect(locked.size).toBe(0);
  });
});

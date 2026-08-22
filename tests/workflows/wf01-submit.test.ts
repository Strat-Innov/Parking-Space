import { describe, it, expect } from "vitest";
import { addDays, addMonths, startOfDay } from "date-fns";
import { submitRequest, WorkflowError } from "@/lib/workflows";
import { prisma } from "../helpers/db";
import { createUser, intake, futureStart, eventsFor } from "../helpers/factories";

describe("WF01 — submission and routing", () => {
  it("creates the request and routes it to In Preparation in one call", async () => {
    const requester = await createUser("REQUESTER");
    const created = await submitRequest(intake(), requester.id);

    expect(created.status).toBe("In Preparation");
    expect(created.approvalStage).toBe("Prepared By");
    expect(created.paymentStatus).toBe("Not Started");
    expect(created.slotStatus).toBe("Unassigned");
    expect(created.requesterId).toBe(requester.id);
    expect(created.rejectionCount).toBe(0);
  });

  // Locks in the two-step create-then-route behaviour explicitly, so that
  // collapsing it later is a deliberate, visible change rather than a silent
  // migration side effect.
  it("writes exactly two WF01 events: item created, then routed", async () => {
    const requester = await createUser("REQUESTER");
    const created = await submitRequest(intake(), requester.id);
    const events = await eventsFor(created.id);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      workflow: "WF01",
      fromStatus: "Submitted",
      toStatus: "Submitted",
      actorId: requester.id,
      note: "Item created",
    });
    expect(events[1]).toMatchObject({
      workflow: "WF01",
      fromStatus: "Submitted",
      toStatus: "In Preparation",
      actorId: null,
      note: "Routed for review",
    });
  });

  it("sets dateOfRequest server-side (BR-003), ignoring any client value", async () => {
    const requester = await createUser("REQUESTER");
    const before = Date.now();
    const created = await submitRequest(intake(), requester.id);
    const after = Date.now();

    expect(created.dateOfRequest.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(created.dateOfRequest.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it("stores an empty requestedSlot as null", async () => {
    const requester = await createUser("REQUESTER");
    const created = await submitRequest(intake({ requestedSlot: "" }), requester.id);
    expect(created.requestedSlot).toBeNull();
  });

  it("keeps a provided requestedSlot as a preference only, not an assignment", async () => {
    const requester = await createUser("REQUESTER");
    const created = await submitRequest(intake({ requestedSlot: "A-99" }), requester.id);

    expect(created.requestedSlot).toBe("A-99");
    expect(created.assignedSlot).toBeNull();
    expect(created.parkingSpaceId).toBeNull();
    expect(created.slotStatus).toBe("Unassigned");
  });
});

describe("BR-001 / BR-002 — no backdating, no same-day requests", () => {
  it("rejects a start date in the past", async () => {
    const requester = await createUser("REQUESTER");
    const start = addDays(startOfDay(new Date()), -1);
    await expect(
      submitRequest(intake({ requiredStartDate: start, endDate: addDays(start, 2) }), requester.id),
    ).rejects.toThrow(/no backdating, no same-day requests/);
  });

  it("rejects a same-calendar-day start even when the time is later today", async () => {
    const requester = await createUser("REQUESTER");
    const start = new Date();
    start.setHours(23, 59, 0, 0);
    await expect(
      submitRequest(
        intake({ requiredStartDate: start, endDate: addDays(start, 1) }),
        requester.id,
      ),
    ).rejects.toThrow(/no backdating, no same-day requests/);
  });

  it("carries HTTP 422 on the intake validation error", async () => {
    const requester = await createUser("REQUESTER");
    const start = new Date();
    start.setHours(23, 59, 0, 0);
    await expect(
      submitRequest(intake({ requiredStartDate: start, endDate: addDays(start, 1) }), requester.id),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("accepts the next calendar day", async () => {
    const requester = await createUser("REQUESTER");
    const created = await submitRequest(intake({ requiredStartDate: futureStart(1) }), requester.id);
    expect(created.status).toBe("In Preparation");
  });
});

describe("intake date rules", () => {
  it("requires End strictly after Required Start", async () => {
    const requester = await createUser("REQUESTER");
    const start = futureStart();
    await expect(
      submitRequest(intake({ requiredStartDate: start, endDate: start }), requester.id),
    ).rejects.toThrow(/End must be after Required Start/);
  });

  it("requires a Monthly booking to span at least one calendar month", async () => {
    const requester = await createUser("REQUESTER");
    const start = futureStart();
    await expect(
      submitRequest(
        intake({ serviceType: "Monthly", requiredStartDate: start, endDate: addDays(start, 10) }),
        requester.id,
      ),
    ).rejects.toThrow(/at least 1 month after the Start Date/);
  });

  it("accepts a Monthly booking of exactly one calendar month", async () => {
    const requester = await createUser("REQUESTER");
    const start = futureStart();
    const created = await submitRequest(
      intake({ serviceType: "Monthly", requiredStartDate: start, endDate: addMonths(start, 1) }),
      requester.id,
    );
    expect(created.totalMonths).toBe(1);
  });

  it("throws WorkflowError, not a raw Prisma error, on invalid intake", async () => {
    const requester = await createUser("REQUESTER");
    const start = futureStart();
    await expect(
      submitRequest(intake({ requiredStartDate: start, endDate: start }), requester.id),
    ).rejects.toBeInstanceOf(WorkflowError);
  });

  it("writes no request and no events when validation fails", async () => {
    const requester = await createUser("REQUESTER");
    const start = futureStart();
    await expect(
      submitRequest(intake({ requiredStartDate: start, endDate: start }), requester.id),
    ).rejects.toThrow();

    expect(await prisma.parkingRequest.count()).toBe(0);
    expect(await prisma.requestEvent.count()).toBe(0);
  });
});

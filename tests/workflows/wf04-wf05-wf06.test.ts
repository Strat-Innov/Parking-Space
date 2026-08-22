import { describe, it, expect } from "vitest";
import { wf04ConfirmPayment, wf05AssignSlot } from "@/lib/workflows";
import { prisma } from "../helpers/db";
import { approvedRequest, createUser, createSpace, sessionFor, eventsFor } from "../helpers/factories";

describe("WF04 — payment confirmation (independent track)", () => {
  it("confirms payment and records the receipt, pay date and actor", async () => {
    const { request, prepared } = await approvedRequest();
    const payDate = new Date("2026-03-01T00:00:00.000Z");

    const updated = await wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-123", payDate);

    expect(updated.paymentStatus).toBe("Confirmed");
    expect(updated.officialReceiptReference).toBe("OR-123");
    expect(updated.payDate?.toISOString()).toBe(payDate.toISOString());
    expect(updated.cashierId).toBe(prepared.id);
  });

  it("does NOT touch the slot track (BR-006)", async () => {
    const { request, prepared } = await approvedRequest();
    const updated = await wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-1", new Date());

    expect(updated.slotStatus).toBe("Unassigned");
    expect(updated.assignedSlot).toBeNull();
    expect(updated.status).toBe("Approved");
  });

  it.each(["VALIDATED_BY", "PARKING_MANAGEMENT", "DEVELOPER"] as const)(
    "refuses %s with 403",
    async (role) => {
      const { request } = await approvedRequest();
      const actor = await createUser(role);
      await expect(
        wf04ConfirmPayment(request.id, sessionFor(actor), "OR-1", new Date()),
      ).rejects.toMatchObject({ status: 403 });
    },
  );

  it("requires an official receipt reference (422)", async () => {
    const { request, prepared } = await approvedRequest();
    await expect(
      wf04ConfirmPayment(request.id, sessionFor(prepared), "  ", new Date()),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("requires a valid pay date (422)", async () => {
    const { request, prepared } = await approvedRequest();
    await expect(
      wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-1", new Date("nonsense")),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses unless the request is Approved (409)", async () => {
    const { request, prepared, validated } = await approvedRequest();
    await prisma.parkingRequest.update({
      where: { id: request.id },
      data: { status: "Pending Approval" },
    });
    void validated;
    await expect(
      wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-1", new Date()),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a double confirmation (409)", async () => {
    const { request, prepared } = await approvedRequest();
    await wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-1", new Date());
    await expect(
      wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-2", new Date()),
    ).rejects.toMatchObject({ status: 409, message: "Payment already confirmed." });
  });

  it("logs a WF04 event carrying the receipt reference", async () => {
    const { request, prepared } = await approvedRequest();
    await wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-77", new Date());

    const events = await eventsFor(request.id);
    const wf04 = events.filter((e) => e.workflow === "WF04");
    expect(wf04).toHaveLength(1);
    expect(wf04[0]).toMatchObject({
      fromStatus: "Not Started",
      toStatus: "Confirmed",
      actorId: prepared.id,
      note: "OR# OR-77",
    });
  });
});

describe("WF05 — slot assignment (independent track)", () => {
  it("assigns the slot and records the human-readable snapshot", async () => {
    const { request } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace("Tower A", "A-07");

    const updated = await wf05AssignSlot(request.id, sessionFor(manager), space.id);

    expect(updated.slotStatus).toBe("Assigned");
    expect(updated.parkingSpaceId).toBe(space.id);
    expect(updated.assignedSlot).toBe("Tower A — A-07");
    expect(updated.assignedById).toBe(manager.id);
    expect(updated.slotAssignmentDate).not.toBeNull();
  });

  it("does NOT touch the payment track (BR-006)", async () => {
    const { request } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    const updated = await wf05AssignSlot(request.id, sessionFor(manager), space.id);

    expect(updated.paymentStatus).toBe("Not Started");
    expect(updated.status).toBe("Approved");
  });

  it.each(["PREPARED_BY", "VALIDATED_BY", "DEVELOPER"] as const)(
    "refuses %s with 403",
    async (role) => {
      const { request } = await approvedRequest();
      const actor = await createUser(role);
      const space = await createSpace();
      await expect(
        wf05AssignSlot(request.id, sessionFor(actor), space.id),
      ).rejects.toMatchObject({ status: 403 });
    },
  );

  it("requires a parking space id (422)", async () => {
    const { request } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    await expect(wf05AssignSlot(request.id, sessionFor(manager), "  ")).rejects.toMatchObject({
      status: 422,
    });
  });

  it("refuses an unknown space with 404", async () => {
    const { request } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    await expect(
      wf05AssignSlot(request.id, sessionFor(manager), "does-not-exist"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a soft-removed (inactive) space with 404", async () => {
    const { request } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();
    await prisma.parkingSpace.update({ where: { id: space.id }, data: { isActive: false } });

    await expect(
      wf05AssignSlot(request.id, sessionFor(manager), space.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a second assignment (409)", async () => {
    const { request } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    const a = await createSpace("Tower A", "A-01");
    const b = await createSpace("Tower A", "A-02");

    await wf05AssignSlot(request.id, sessionFor(manager), a.id);
    await expect(wf05AssignSlot(request.id, sessionFor(manager), b.id)).rejects.toMatchObject({
      status: 409,
      message: "A slot is already assigned.",
    });
  });

  it("logs a WF05 event carrying the assigned slot", async () => {
    const { request } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace("Tower B", "B-12");
    await wf05AssignSlot(request.id, sessionFor(manager), space.id);

    const events = await eventsFor(request.id);
    const wf05 = events.filter((e) => e.workflow === "WF05");
    expect(wf05).toHaveLength(1);
    expect(wf05[0]).toMatchObject({
      fromStatus: "Unassigned",
      toStatus: "Assigned",
      actorId: manager.id,
      note: "Slot Tower B — B-12",
    });
  });
});

describe("WF06 / BR-006 / BR-007 — completion join", () => {
  it("stays Approved when only payment is confirmed", async () => {
    const { request, prepared } = await approvedRequest();
    const updated = await wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-1", new Date());

    expect(updated.status).toBe("Approved");
    expect(updated.completedDate).toBeNull();
  });

  it("stays Approved when only the slot is assigned", async () => {
    const { request } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();
    const updated = await wf05AssignSlot(request.id, sessionFor(manager), space.id);

    expect(updated.status).toBe("Approved");
    expect(updated.completedDate).toBeNull();
  });

  it("completes when payment lands first, then the slot", async () => {
    const { request, prepared } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    await wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-1", new Date());
    const final = await wf05AssignSlot(request.id, sessionFor(manager), space.id);

    expect(final.status).toBe("Completed");
    expect(final.approvalStage).toBe("Completed");
    expect(final.completedDate).not.toBeNull();
  });

  it("completes when the slot lands first, then payment (order-independent)", async () => {
    const { request, prepared } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    await wf05AssignSlot(request.id, sessionFor(manager), space.id);
    const final = await wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-1", new Date());

    expect(final.status).toBe("Completed");
    expect(final.approvalStage).toBe("Completed");
    expect(final.completedDate).not.toBeNull();
  });

  // BR-007: WF06 is the sole writer of Completed. Whichever track finishes
  // second, the Completed transition must be attributed to WF06 — never to
  // WF04 or WF05 directly.
  it("attributes the Completed transition to exactly one WF06 event", async () => {
    const { request, prepared } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    await wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-1", new Date());
    await wf05AssignSlot(request.id, sessionFor(manager), space.id);

    const events = await eventsFor(request.id);
    const completing = events.filter((e) => e.toStatus === "Completed");

    expect(completing).toHaveLength(1);
    expect(completing[0]).toMatchObject({
      workflow: "WF06",
      fromStatus: "Approved",
      toStatus: "Completed",
      actorId: null,
      note: "Both tracks confirmed (BR-007)",
    });
  });

  it("emits the same single WF06 event in the reverse track order", async () => {
    const { request, prepared } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    await wf05AssignSlot(request.id, sessionFor(manager), space.id);
    await wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-1", new Date());

    const events = await eventsFor(request.id);
    expect(events.filter((e) => e.workflow === "WF06")).toHaveLength(1);
  });

  it("no workflow other than WF06 ever writes toStatus Completed", async () => {
    const { request, prepared } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    const space = await createSpace();

    await wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-1", new Date());
    await wf05AssignSlot(request.id, sessionFor(manager), space.id);

    const offenders = await prisma.requestEvent.findMany({
      where: { toStatus: "Completed", workflow: { not: "WF06" } },
    });
    expect(offenders).toHaveLength(0);
  });
});

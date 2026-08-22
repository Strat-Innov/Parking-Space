import { describe, it, expect } from "vitest";
import {
  submitRequest,
  wf02EndorseForValidation,
  wf03Decide,
  wf04ConfirmPayment,
  wf05AssignSlot,
  wfDevRevertPhase,
  cancelRequest,
} from "@/lib/workflows";
import { prisma } from "../helpers/db";
import {
  approvedRequest,
  createUser,
  createSpace,
  createRate,
  sessionFor,
  intake,
  eventsFor,
} from "../helpers/factories";

async function completedRequest() {
  const { request, prepared } = await approvedRequest();
  const manager = await createUser("PARKING_MANAGEMENT");
  const space = await createSpace();
  await wf04ConfirmPayment(request.id, sessionFor(prepared), "OR-1", new Date());
  const final = await wf05AssignSlot(request.id, sessionFor(manager), space.id);
  return { request: final, prepared, manager };
}

describe("Developer revert one phase", () => {
  it("reverts Pending Approval back to In Preparation and clears preparedById", async () => {
    const requester = await createUser("REQUESTER");
    const prepared = await createUser("PREPARED_BY");
    const developer = await createUser("DEVELOPER");
    const request = await submitRequest(intake(), requester.id);
    await wf02EndorseForValidation(request.id, sessionFor(prepared));

    const reverted = await wfDevRevertPhase(request.id, sessionFor(developer));

    expect(reverted.status).toBe("In Preparation");
    expect(reverted.approvalStage).toBe("Prepared By");
    expect(reverted.preparedById).toBeNull();
  });

  it("reverts Approved and strips the rate snapshot and both tracks", async () => {
    const { request } = await approvedRequest();
    const developer = await createUser("DEVELOPER");

    const reverted = await wfDevRevertPhase(request.id, sessionFor(developer));

    expect(reverted.status).toBe("Pending Approval");
    expect(reverted.approvalStage).toBe("Validated By");
    expect(reverted.approvalDecision).toBeNull();
    expect(reverted.validatedById).toBeNull();
    expect(reverted.rateVersionId).toBeNull();
    expect(reverted.rateAmountSnapshot).toBeNull();
    expect(reverted.totalPaymentDue).toBeNull();
    expect(reverted.paymentStatus).toBe("Not Started");
    expect(reverted.slotStatus).toBe("Unassigned");
    expect(reverted.parkingSpaceId).toBeNull();
  });

  it("reverts Completed to Approved but keeps payment and slot intact", async () => {
    const { request } = await completedRequest();
    const developer = await createUser("DEVELOPER");

    const reverted = await wfDevRevertPhase(request.id, sessionFor(developer));

    expect(reverted.status).toBe("Approved");
    expect(reverted.approvalStage).toBe("Post-Approval");
    expect(reverted.completedDate).toBeNull();
    expect(reverted.paymentStatus).toBe("Confirmed");
    expect(reverted.slotStatus).toBe("Assigned");
  });

  it.each(["PREPARED_BY", "VALIDATED_BY", "PARKING_MANAGEMENT"] as const)(
    "refuses %s with 403",
    async (role) => {
      const { request } = await approvedRequest();
      const actor = await createUser(role);
      await expect(wfDevRevertPhase(request.id, sessionFor(actor))).rejects.toMatchObject({
        status: 403,
      });
    },
  );

  it("refuses to revert from In Preparation (two possible sources)", async () => {
    const requester = await createUser("REQUESTER");
    const developer = await createUser("DEVELOPER");
    const request = await submitRequest(intake(), requester.id);

    await expect(wfDevRevertPhase(request.id, sessionFor(developer))).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses to revert from Cancelled", async () => {
    const { request } = await approvedRequest();
    const developer = await createUser("DEVELOPER");
    await prisma.parkingRequest.update({
      where: { id: request.id },
      data: { status: "Cancelled" },
    });

    await expect(wfDevRevertPhase(request.id, sessionFor(developer))).rejects.toMatchObject({
      status: 409,
    });
  });

  it("logs a DEV_REVERT event", async () => {
    const { request } = await approvedRequest();
    const developer = await createUser("DEVELOPER");
    await wfDevRevertPhase(request.id, sessionFor(developer));

    const events = await eventsFor(request.id);
    expect(events.at(-1)).toMatchObject({
      workflow: "DEV_REVERT",
      fromStatus: "Approved",
      toStatus: "Pending Approval",
      actorId: developer.id,
    });
  });
});

describe("cancellation", () => {
  it.each(["VALIDATED_BY", "PARKING_MANAGEMENT", "DEVELOPER"] as const)(
    "lets %s cancel a non-terminal request",
    async (role) => {
      const requester = await createUser("REQUESTER");
      const actor = await createUser(role);
      const request = await submitRequest(intake(), requester.id);

      const cancelled = await cancelRequest(request.id, sessionFor(actor));
      expect(cancelled.status).toBe("Cancelled");
    },
  );

  it("refuses Prepared By with 403", async () => {
    const requester = await createUser("REQUESTER");
    const prepared = await createUser("PREPARED_BY");
    const request = await submitRequest(intake(), requester.id);

    await expect(cancelRequest(request.id, sessionFor(prepared))).rejects.toMatchObject({
      status: 403,
      message: "Not permitted to cancel this request.",
    });
  });

  it("refuses to cancel a Completed request", async () => {
    const { request } = await completedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");

    await expect(cancelRequest(request.id, sessionFor(manager))).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses to cancel an already-Cancelled request", async () => {
    const requester = await createUser("REQUESTER");
    const manager = await createUser("PARKING_MANAGEMENT");
    const request = await submitRequest(intake(), requester.id);
    await cancelRequest(request.id, sessionFor(manager));

    await expect(cancelRequest(request.id, sessionFor(manager))).rejects.toMatchObject({
      status: 409,
    });
  });

  it("logs a CANCEL event recording the prior status", async () => {
    await createRate("Daily", 100);
    const { request } = await approvedRequest();
    const manager = await createUser("PARKING_MANAGEMENT");
    await cancelRequest(request.id, sessionFor(manager));

    const events = await eventsFor(request.id);
    expect(events.at(-1)).toMatchObject({
      workflow: "CANCEL",
      fromStatus: "Approved",
      toStatus: "Cancelled",
      actorId: manager.id,
    });
  });

  it("keeps the row for the audit trail rather than deleting it", async () => {
    const requester = await createUser("REQUESTER");
    const manager = await createUser("PARKING_MANAGEMENT");
    const request = await submitRequest(intake(), requester.id);
    await cancelRequest(request.id, sessionFor(manager));

    expect(await prisma.parkingRequest.count({ where: { id: request.id } })).toBe(1);
  });
});

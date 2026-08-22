import { describe, it, expect } from "vitest";
import { addDays } from "date-fns";
import { submitRequest, wf02EndorseForValidation, wf03Decide } from "@/lib/workflows";
import { prisma } from "../helpers/db";
import { createUser, sessionFor, intake, createRate, eventsFor, futureStart } from "../helpers/factories";
import type { ServiceType } from "@/lib/types";

async function pendingApproval(serviceType: ServiceType = "Daily", overrides = {}) {
  const requester = await createUser("REQUESTER");
  const prepared = await createUser("PREPARED_BY");
  const validated = await createUser("VALIDATED_BY");
  const request = await submitRequest(intake({ serviceType, ...overrides }), requester.id);
  await wf02EndorseForValidation(request.id, sessionFor(prepared));
  return { request, validated, prepared, requester };
}

describe("WF03 — approval", () => {
  it("approves, moves to Post-Approval, and stamps the validator", async () => {
    const { request, validated } = await pendingApproval();
    await createRate("Daily", 500);

    const approved = await wf03Decide(request.id, sessionFor(validated), "Approved");

    expect(approved.status).toBe("Approved");
    expect(approved.approvalStage).toBe("Post-Approval");
    expect(approved.approvalDecision).toBe("Approved");
    expect(approved.validatedById).toBe(validated.id);
    expect(approved.validatedDate).not.toBeNull();
  });

  it("opens both BR-006 tracks in their initial state", async () => {
    const { request, validated } = await pendingApproval();
    await createRate("Daily", 500);
    const approved = await wf03Decide(request.id, sessionFor(validated), "Approved");

    expect(approved.paymentStatus).toBe("Not Started");
    expect(approved.slotStatus).toBe("Unassigned");
  });

  it("refuses a non-Validated By actor with 403", async () => {
    const { request, prepared } = await pendingApproval();
    await createRate("Daily", 500);
    await expect(wf03Decide(request.id, sessionFor(prepared), "Approved")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("refuses unless status is Pending Approval", async () => {
    const requester = await createUser("REQUESTER");
    const validated = await createUser("VALIDATED_BY");
    const request = await submitRequest(intake(), requester.id); // still In Preparation
    await createRate("Daily", 500);

    await expect(wf03Decide(request.id, sessionFor(validated), "Approved")).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("WF03 — rate snapshot (Section 7)", () => {
  it("snapshots the current rate at approval and computes payment due", async () => {
    const start = futureStart();
    const { request, validated } = await pendingApproval("Daily", {
      requiredStartDate: start,
      endDate: addDays(start, 3),
    });
    const rate = await createRate("Daily", 250);

    const approved = await wf03Decide(request.id, sessionFor(validated), "Approved");

    expect(approved.rateVersionId).toBe(rate.id);
    expect(approved.rateAmountSnapshot).toBe(250);
    expect(approved.rateSnapshotDate).not.toBeNull();
    expect(approved.totalDays).toBe(3);
    expect(approved.totalPaymentDue).toBe(750);
  });

  it("resolves the most recent rate effective on or before now", async () => {
    const { request, validated } = await pendingApproval();
    await createRate("Daily", 100, new Date("2020-01-01"));
    const newer = await createRate("Daily", 300, new Date("2024-06-01"));
    // Not yet in force — must be ignored.
    await createRate("Daily", 999, addDays(new Date(), 30));

    const approved = await wf03Decide(request.id, sessionFor(validated), "Approved");

    expect(approved.rateVersionId).toBe(newer.id);
    expect(approved.rateAmountSnapshot).toBe(300);
  });

  it("does not re-derive the snapshot when a newer rate is added later", async () => {
    const { request, validated } = await pendingApproval();
    await createRate("Daily", 200);
    const approved = await wf03Decide(request.id, sessionFor(validated), "Approved");

    await createRate("Daily", 900, new Date());

    const reread = await prisma.parkingRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(reread.rateAmountSnapshot).toBe(200);
    expect(reread.totalPaymentDue).toBe(approved.totalPaymentDue);
  });

  it("refuses approval with 409 when no rate is effective for the service type", async () => {
    const { request, validated } = await pendingApproval("Monthly");
    await createRate("Daily", 100); // wrong service type

    await expect(wf03Decide(request.id, sessionFor(validated), "Approved")).rejects.toMatchObject({
      status: 409,
    });
    await expect(wf03Decide(request.id, sessionFor(validated), "Approved")).rejects.toThrow(
      /No effective rate configured/,
    );
  });

  it("rounds the total to two decimal places", async () => {
    const start = futureStart();
    const { request, validated } = await pendingApproval("Daily", {
      requiredStartDate: start,
      endDate: addDays(start, 3),
    });
    await createRate("Daily", 33.333);

    const approved = await wf03Decide(request.id, sessionFor(validated), "Approved");
    expect(approved.totalPaymentDue).toBe(100);
  });

  it("logs the snapshot in the WF03 event note", async () => {
    const { request, validated } = await pendingApproval();
    const rate = await createRate("Daily", 250);
    await wf03Decide(request.id, sessionFor(validated), "Approved");

    const events = await eventsFor(request.id);
    expect(events.at(-1)).toMatchObject({
      workflow: "WF03",
      fromStatus: "Pending Approval",
      toStatus: "Approved",
      note: `Rate snapshot v${rate.id} @ 250`,
    });
  });
});

describe("WF03 — BR-004 reject loop", () => {
  it("returns the SAME item to In Preparation / Prepared By", async () => {
    const { request, validated } = await pendingApproval();

    const rejected = await wf03Decide(request.id, sessionFor(validated), "Rejected", "Missing purpose");

    expect(rejected.id).toBe(request.id);
    expect(rejected.status).toBe("In Preparation");
    expect(rejected.approvalStage).toBe("Prepared By");
    expect(await prisma.parkingRequest.count()).toBe(1);
  });

  it("records the rejection audit fields and increments the count", async () => {
    const { request, validated } = await pendingApproval();
    const rejected = await wf03Decide(request.id, sessionFor(validated), "Rejected", "Missing purpose");

    expect(rejected.approvalDecision).toBe("Rejected");
    expect(rejected.rejectionCount).toBe(1);
    expect(rejected.rejectionReason).toBe("Missing purpose");
    expect(rejected.rejectedById).toBe(validated.id);
    expect(rejected.rejectedDate).not.toBeNull();
  });

  it("increments rejectionCount across repeated loops", async () => {
    const { request, validated, prepared } = await pendingApproval();

    await wf03Decide(request.id, sessionFor(validated), "Rejected", "first");
    await wf02EndorseForValidation(request.id, sessionFor(prepared));
    const second = await wf03Decide(request.id, sessionFor(validated), "Rejected", "second");

    expect(second.rejectionCount).toBe(2);
    expect(second.rejectionReason).toBe("second");
  });

  it("requires a rejection reason (422)", async () => {
    const { request, validated } = await pendingApproval();
    await expect(
      wf03Decide(request.id, sessionFor(validated), "Rejected", "   "),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("never takes a rate snapshot on rejection", async () => {
    const { request, validated } = await pendingApproval();
    await createRate("Daily", 500);
    const rejected = await wf03Decide(request.id, sessionFor(validated), "Rejected", "no");

    expect(rejected.rateVersionId).toBeNull();
    expect(rejected.rateAmountSnapshot).toBeNull();
    expect(rejected.totalPaymentDue).toBeNull();
  });

  it("logs the rejection reason in the event", async () => {
    const { request, validated } = await pendingApproval();
    await wf03Decide(request.id, sessionFor(validated), "Rejected", "Missing purpose");

    const events = await eventsFor(request.id);
    expect(events.at(-1)).toMatchObject({
      workflow: "WF03",
      fromStatus: "Pending Approval",
      toStatus: "In Preparation",
      note: "Rejected: Missing purpose",
    });
  });

  it("never records Rejected as a resting Status (Section 2)", async () => {
    const { request, validated } = await pendingApproval();
    const rejected = await wf03Decide(request.id, sessionFor(validated), "Rejected", "no");
    expect(rejected.status).not.toBe("Rejected");
  });
});

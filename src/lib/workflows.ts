import { Prisma, ParkingRequest } from "@prisma/client";
import { prisma } from "./prisma";
import type { SessionPayload } from "./auth";
import type { ServiceType } from "./types";

// Domain errors carry an HTTP status so API routes can translate them
// without re-deriving the reason for the failure.
export class WorkflowError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Tx = Prisma.TransactionClient;

// --- Section 5 computed fields -------------------------------------------------

const MS_HOUR = 1000 * 60 * 60;
const MS_DAY = MS_HOUR * 24;

export function computeTotals(serviceType: ServiceType, start: Date, end: Date) {
  const spanMs = end.getTime() - start.getTime();
  const totals = { totalHours: null as number | null, totalDays: null as number | null, totalMonths: null as number | null };
  if (serviceType === "Hourly") totals.totalHours = Math.max(1, Math.ceil(spanMs / MS_HOUR));
  if (serviceType === "Daily") totals.totalDays = Math.max(1, Math.ceil(spanMs / MS_DAY));
  if (serviceType === "Monthly") totals.totalMonths = Math.max(1, Math.ceil(spanMs / (MS_DAY * 30)));
  return totals;
}

function unitsFor(serviceType: ServiceType, req: Pick<ParkingRequest, "totalHours" | "totalDays" | "totalMonths">) {
  if (serviceType === "Hourly") return req.totalHours ?? 0;
  if (serviceType === "Daily") return req.totalDays ?? 0;
  return req.totalMonths ?? 0;
}

// --- Section 7 — Rate Table resolution -----------------------------------------
//
// Append-only: we never edit a past row. "Current rate" is resolved by
// picking the most recent row whose effectiveStartDate has passed, as of
// `asOf`. This is what keeps old snapshots audit-safe even if the table is
// edited later — the OLD row is untouched, so any ID-only pointer into it
// still resolves to the value that was actually in force at the time.
async function resolveCurrentRate(tx: Tx, serviceType: string, asOf: Date) {
  const rate = await tx.rateTableEntry.findFirst({
    where: { serviceType, effectiveStartDate: { lte: asOf } },
    orderBy: { effectiveStartDate: "desc" },
  });
  if (!rate) {
    throw new WorkflowError(`No effective rate configured for service type "${serviceType}" as of ${asOf.toISOString()}`, 409);
  }
  return rate;
}

async function logEvent(
  tx: Tx,
  requestId: string,
  workflow: string,
  fromStatus: string | null,
  toStatus: string | null,
  actorId: string | null,
  note?: string
) {
  await tx.requestEvent.create({
    data: { requestId, workflow, fromStatus, toStatus, actorId, note },
  });
}

// --- Submission + WF01 (Route for Review) ---------------------------------------
//
// WF01 owns exactly one transition: Submitted -> In Preparation. It fires
// the instant the item is created, so in practice a caller never observes a
// request actually resting in "Submitted" — that's intentional, it mirrors
// "Item created" as WF01's trigger in the architecture doc.

export type SubmitRequestInput = {
  companyName: string;
  emailAddress: string;
  serviceType: ServiceType;
  preferredParkingLocation: string;
  requiredStartDate: Date;
  endDate: Date;
  purpose: string;
};

export async function submitRequest(input: SubmitRequestInput, requesterId: string) {
  const dateOfRequest = new Date(); // system-set — BR-003, never taken from the client

  // BR-001 (no backdating) + BR-002 (advance requests only, strict inequality)
  if (input.requiredStartDate <= dateOfRequest) {
    throw new WorkflowError(
      "Required Start Date must be strictly after the date of request (BR-001/BR-002 — no backdating, no same-day requests).",
      422
    );
  }
  if (input.endDate < input.requiredStartDate) {
    throw new WorkflowError("End Date cannot be before Required Start Date.", 422);
  }

  const totals = computeTotals(input.serviceType, input.requiredStartDate, input.endDate);

  return prisma.$transaction(async (tx) => {
    const created = await tx.parkingRequest.create({
      data: {
        companyName: input.companyName,
        emailAddress: input.emailAddress,
        serviceType: input.serviceType,
        preferredParkingLocation: input.preferredParkingLocation,
        dateOfRequest,
        requiredStartDate: input.requiredStartDate,
        endDate: input.endDate,
        purpose: input.purpose,
        status: "Submitted",
        approvalStage: "Prepared By",
        requesterId,
        ...totals,
      },
    });
    await logEvent(tx, created.id, "WF01", "Submitted", "Submitted", requesterId, "Item created");

    // WF01: Submitted -> In Preparation, fired immediately on creation.
    const routed = await tx.parkingRequest.update({
      where: { id: created.id },
      data: { status: "In Preparation" },
    });
    await logEvent(tx, created.id, "WF01", "Submitted", "In Preparation", null, "Routed for review");

    return routed;
  });
}

// --- WF02 — Prepared By Validation ------------------------------------------------

export async function wf02MarkReadyForApproval(requestId: string, actor: SessionPayload) {
  if (actor.role !== "PREPARED_BY") throw new WorkflowError("Only Prepared By can advance this request.", 403);

  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status !== "In Preparation") {
      throw new WorkflowError(`WF02 requires Status = "In Preparation" (current: "${req.status}").`, 409);
    }
    const updated = await tx.parkingRequest.update({
      where: { id: requestId },
      data: { status: "Pending Approval", approvalStage: "Validated By", preparedById: actor.sub },
    });
    await logEvent(tx, requestId, "WF02", "In Preparation", "Pending Approval", actor.sub, "Prepared-by validation complete");
    return updated;
  });
}

// --- WF03 — Approval Decision (two exits: Approved, or reject-loop) -----------------

export async function wf03Decide(
  requestId: string,
  actor: SessionPayload,
  decision: "Approved" | "Rejected",
  rejectionReason?: string
) {
  if (actor.role !== "VALIDATED_BY") throw new WorkflowError("Only Validated By can record an approval decision.", 403);

  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status !== "Pending Approval") {
      throw new WorkflowError(`WF03 requires Status = "Pending Approval" (current: "${req.status}").`, 409);
    }

    const now = new Date();

    if (decision === "Rejected") {
      if (!rejectionReason?.trim()) throw new WorkflowError("Rejection reason is required.", 422);
      // BR-004: loop back to In Preparation / Prepared By. Same item — no
      // duplicate is ever created, and the requester is never re-involved.
      const updated = await tx.parkingRequest.update({
        where: { id: requestId },
        data: {
          status: "In Preparation",
          approvalStage: "Prepared By",
          approvalDecision: "Rejected",
          validatedById: actor.sub,
          validatedDate: now,
          rejectionCount: { increment: 1 },
          rejectionReason,
          rejectedById: actor.sub,
          rejectedDate: now,
        },
      });
      await logEvent(tx, requestId, "WF03", "Pending Approval", "In Preparation", actor.sub, `Rejected: ${rejectionReason}`);
      return updated;
    }

    // decision === "Approved" — rate snapshot happens exactly here (Section 7:
    // "Rate snapshot timing: Approval / WF03 exit", not at Submission).
    const rate = await resolveCurrentRate(tx, req.serviceType, now);
    const units = unitsFor(req.serviceType as ServiceType, req);
    const totalPaymentDue = Math.round(rate.rateAmount * units * 100) / 100;

    const updated = await tx.parkingRequest.update({
      where: { id: requestId },
      data: {
        status: "Approved",
        approvalStage: "Post-Approval",
        approvalDecision: "Approved",
        validatedById: actor.sub,
        validatedDate: now,
        rateVersionId: rate.id,
        rateAmountSnapshot: rate.rateAmount,
        rateSnapshotDate: now,
        totalPaymentDue,
      },
    });
    await logEvent(tx, requestId, "WF03", "Pending Approval", "Approved", actor.sub, `Rate snapshot v${rate.id} @ ${rate.rateAmount}`);
    return updated;
  });
}

// --- WF06 — Completion Check ------------------------------------------------------
// The ONLY workflow permitted to write Status = Completed (BR-007). Called
// from inside WF04/WF05 after either track changes; never invoked directly
// by a route so the "check both" logic lives in exactly one place.

async function wf06CheckCompletion(tx: Tx, requestId: string) {
  const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (req.status !== "Approved") return req; // nothing to do outside the Approved window
  if (req.paymentStatus === "Confirmed" && req.slotStatus === "Assigned") {
    const now = new Date();
    const updated = await tx.parkingRequest.update({
      where: { id: requestId },
      data: { status: "Completed", approvalStage: "Completed", completedDate: now },
    });
    await logEvent(tx, requestId, "WF06", "Approved", "Completed", null, "Both tracks confirmed (BR-007)");
    return updated;
  }
  return req;
}

// --- WF04 — Payment Processing (independent track, BR-006) ------------------------

export async function wf04StartPayment(requestId: string, actor: SessionPayload) {
  if (actor.role !== "CASHIER") throw new WorkflowError("Only Cashier can process payment.", 403);
  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status !== "Approved") throw new WorkflowError('WF04 requires Status = "Approved".', 409);
    if (req.paymentStatus !== "Not Started") throw new WorkflowError(`Payment already ${req.paymentStatus}.`, 409);
    const updated = await tx.parkingRequest.update({
      where: { id: requestId },
      data: { paymentStatus: "Pending", cashierId: actor.sub },
    });
    await logEvent(tx, requestId, "WF04", null, null, actor.sub, "Payment processing started");
    return updated;
  });
}

export async function wf04ConfirmPayment(requestId: string, actor: SessionPayload, officialReceiptReference: string) {
  if (actor.role !== "CASHIER") throw new WorkflowError("Only Cashier can confirm payment.", 403);
  if (!officialReceiptReference?.trim()) throw new WorkflowError("Official Receipt Reference is required.", 422);

  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status !== "Approved") throw new WorkflowError('WF04 requires Status = "Approved".', 409);
    if (req.paymentStatus === "Confirmed") throw new WorkflowError("Payment already confirmed.", 409);

    await tx.parkingRequest.update({
      where: { id: requestId },
      data: {
        paymentStatus: "Confirmed",
        cashierId: actor.sub,
        payDate: new Date(),
        officialReceiptReference,
      },
    });
    await logEvent(tx, requestId, "WF04", req.paymentStatus, "Confirmed", actor.sub, `OR# ${officialReceiptReference}`);

    // WF04 never checks Slot Status itself (BR-006) — it only hands off to
    // the single join workflow.
    return wf06CheckCompletion(tx, requestId);
  });
}

// --- WF05 — Slot Assignment (independent track, BR-006) ---------------------------

export async function wf05AssignSlot(requestId: string, actor: SessionPayload, assignedSlot: string) {
  if (actor.role !== "PARKING_MANAGEMENT") throw new WorkflowError("Only Parking Management can assign a slot.", 403);
  if (!assignedSlot?.trim()) throw new WorkflowError("A slot/space number is required.", 422);

  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status !== "Approved") throw new WorkflowError('WF05 requires Status = "Approved".', 409);
    if (req.slotStatus === "Assigned") throw new WorkflowError("A slot is already assigned.", 409);

    await tx.parkingRequest.update({
      where: { id: requestId },
      data: {
        slotStatus: "Assigned",
        assignedSlot,
        slotAssignmentDate: new Date(),
        assignedById: actor.sub,
      },
    });
    await logEvent(tx, requestId, "WF05", "Unassigned", "Assigned", actor.sub, `Slot ${assignedSlot}`);

    // WF05 never checks Payment Status itself (BR-006) — same single
    // join-workflow hand-off as WF04.
    return wf06CheckCompletion(tx, requestId);
  });
}

// --- Cancellation (reachable from any non-terminal state) -------------------------

export async function cancelRequest(requestId: string, actor: SessionPayload) {
  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status === "Completed" || req.status === "Cancelled") {
      throw new WorkflowError(`Cannot cancel a request that is already ${req.status}.`, 409);
    }
    const isOwner = req.requesterId === actor.sub;
    const isStaff = actor.role !== "REQUESTER";
    if (!isOwner && !isStaff) throw new WorkflowError("Not permitted to cancel this request.", 403);

    const updated = await tx.parkingRequest.update({
      where: { id: requestId },
      data: { status: "Cancelled" },
    });
    await logEvent(tx, requestId, "CANCEL", req.status, "Cancelled", actor.sub);
    return updated;
  });
}

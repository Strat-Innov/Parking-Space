import { Prisma, ParkingRequest } from "@prisma/client";
import { startOfDay, addMonths, differenceInCalendarMonths } from "date-fns";
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

// Calendar-aware month count — NOT spanMs / 30 days. A fixed 30-day divisor
// overcharges real 1-month bookings in any 31-day month (Aug 10 -> Sep 10 is
// 31 real days, so ceil(31/30) = 2 would silently bill two months for what
// is, by the calendar, exactly one).
function monthsBetween(start: Date, end: Date): number {
  let months = differenceInCalendarMonths(end, start);
  if (addMonths(start, months) < end) months += 1;
  return Math.max(1, months);
}

export function computeTotals(serviceType: ServiceType, start: Date, end: Date) {
  const spanMs = end.getTime() - start.getTime();
  const totals = { totalHours: null as number | null, totalDays: null as number | null, totalMonths: null as number | null };
  if (serviceType === "Hourly") totals.totalHours = Math.max(1, Math.ceil(spanMs / MS_HOUR));
  if (serviceType === "Daily") totals.totalDays = Math.max(1, Math.ceil(spanMs / MS_DAY));
  if (serviceType === "Monthly") totals.totalMonths = monthsBetween(start, end);
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
  fullName: string;
  companyName: string;
  emailAddress: string;
  serviceType: ServiceType;
  preferredParkingLocation: string;
  requestedSlot?: string;
  requiredStartDate: Date;
  endDate: Date;
  purpose: string;
};

// Shared by submitRequest and updateRequestDetails so an edit can never
// hold the intake fields to a looser standard than the original
// submission. `dateOfRequest` is the anchor for BR-001/002 either way — on
// an edit that's the request's ORIGINAL (immutable) Date of Request, not
// "now", since BR-003 fixes it at submission and edits don't reset it.
function validateIntakeFields(input: SubmitRequestInput, dateOfRequest: Date) {
  // BR-001 (no backdating) + BR-002 (advance requests only — "no same-day
  // requests" is a CALENDAR-DAY rule, not just "later timestamp"). Now that
  // Required Start Date/End Date carry a time-of-day, comparing raw
  // timestamps would let someone book 5 minutes from now — still today.
  // Compare start-of-day so BR-002 holds regardless of what time is picked.
  if (startOfDay(input.requiredStartDate) <= startOfDay(dateOfRequest)) {
    throw new WorkflowError(
      "Required Start Date must be on a later calendar day than the date of request — no backdating, no same-day requests.",
      422
    );
  }
  // Every service type now carries a real time-of-day (Hourly: independent
  // Start/End times; Daily/Monthly: a single check-in time mirrored onto
  // both ends — see NewRequestForm) rather than an implicit midnight, so
  // "End strictly after Start" is a universal rule, not Hourly-only.
  if (input.endDate <= input.requiredStartDate) {
    throw new WorkflowError("End must be after Required Start (date and time).", 422);
  }
  // Monthly additionally needs a minimum 1-calendar-month span — a few days
  // into the same month is not a monthly booking (this was the bug: the
  // generic "after Start" check alone doesn't enforce that).
  if (input.serviceType === "Monthly") {
    const minEnd = addMonths(input.requiredStartDate, 1);
    if (input.endDate < minEnd) {
      throw new WorkflowError("Monthly bookings need an End Date at least 1 month after the Start Date.", 422);
    }
  }
}

export async function submitRequest(input: SubmitRequestInput, requesterId: string) {
  const dateOfRequest = new Date(); // system-set — BR-003, never taken from the client
  validateIntakeFields(input, dateOfRequest);

  const totals = computeTotals(input.serviceType, input.requiredStartDate, input.endDate);

  return prisma.$transaction(async (tx) => {
    const created = await tx.parkingRequest.create({
      data: {
        fullName: input.fullName,
        companyName: input.companyName,
        emailAddress: input.emailAddress,
        serviceType: input.serviceType,
        preferredParkingLocation: input.preferredParkingLocation,
        requestedSlot: input.requestedSlot || null,
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
//
// Prepared By can correct the intake fields the requestor submitted (typos,
// missing details) while the item is still theirs to prepare — this is NOT
// a BR-003 violation: BR-003 revokes the REQUESTOR's edit rights on
// submission, it says nothing about staff. Locked the moment the item
// leaves "In Preparation" (endorsed for validation, or beyond), same as
// every other field on this record past its owning stage.

export async function updateRequestDetails(requestId: string, actor: SessionPayload, input: SubmitRequestInput) {
  if (actor.role !== "PREPARED_BY") throw new WorkflowError("Only Prepared By can edit request details.", 403);

  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status !== "In Preparation") {
      throw new WorkflowError('Details can only be edited while Status = "In Preparation".', 409);
    }

    // Anchored to the ORIGINAL Date of Request, not "now" — see
    // validateIntakeFields' comment.
    validateIntakeFields(input, req.dateOfRequest);
    const totals = computeTotals(input.serviceType, input.requiredStartDate, input.endDate);

    const updated = await tx.parkingRequest.update({
      where: { id: requestId },
      data: {
        fullName: input.fullName,
        companyName: input.companyName,
        emailAddress: input.emailAddress,
        serviceType: input.serviceType,
        preferredParkingLocation: input.preferredParkingLocation,
        requestedSlot: input.requestedSlot || null,
        requiredStartDate: input.requiredStartDate,
        endDate: input.endDate,
        purpose: input.purpose,
        ...totals,
      },
    });
    await logEvent(tx, requestId, "WF02", null, null, actor.sub, "Details edited by Prepared By");
    return updated;
  });
}

export async function wf02EndorseForValidation(requestId: string, actor: SessionPayload) {
  if (actor.role !== "PREPARED_BY") throw new WorkflowError("Only Prepared By can advance this request.", 403);

  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status !== "In Preparation") {
      throw new WorkflowError(`Requires Status = "In Preparation" (current: "${req.status}").`, 409);
    }
    const updated = await tx.parkingRequest.update({
      where: { id: requestId },
      data: { status: "Pending Approval", approvalStage: "Validated By", preparedById: actor.sub },
    });
    await logEvent(tx, requestId, "WF02", "In Preparation", "Pending Approval", actor.sub, "Endorsed for validation");
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
      throw new WorkflowError(`Requires Status = "Pending Approval" (current: "${req.status}").`, 409);
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
// Owned by Prepared By, not a separate Cashier role — a single-step inline
// edit (Official Receipt Reference + Pay Date) rather than a two-phase
// start/confirm flow, since there's no longer a second actor for "Pending"
// to signal handoff to. cashierId/cashier stay the underlying column/relation
// names (no schema change) but now record whichever Prepared By staffer
// confirmed the payment.

export async function wf04ConfirmPayment(
  requestId: string,
  actor: SessionPayload,
  officialReceiptReference: string,
  payDate: Date
) {
  if (actor.role !== "PREPARED_BY") throw new WorkflowError("Only Prepared By can confirm payment.", 403);
  if (!officialReceiptReference?.trim()) throw new WorkflowError("Official Receipt Reference is required.", 422);
  if (!payDate || Number.isNaN(payDate.getTime())) throw new WorkflowError("A valid Pay Date is required.", 422);

  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status !== "Approved") throw new WorkflowError('Requires Status = "Approved".', 409);
    if (req.paymentStatus === "Confirmed") throw new WorkflowError("Payment already confirmed.", 409);

    await tx.parkingRequest.update({
      where: { id: requestId },
      data: {
        paymentStatus: "Confirmed",
        cashierId: actor.sub,
        payDate,
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

// A space is unavailable only for the specific window it's actually booked
// (Cancelled requests never held it; excludeRequestId lets a request check
// against every OTHER booking without tripping over its own row).
async function findConflictingBooking(
  tx: Tx,
  parkingSpaceId: string,
  start: Date,
  end: Date,
  excludeRequestId?: string
) {
  return tx.parkingRequest.findFirst({
    where: {
      parkingSpaceId,
      slotStatus: "Assigned",
      status: { not: "Cancelled" },
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      requiredStartDate: { lt: end },
      endDate: { gt: start },
    },
  });
}

// Used outside a transaction (e.g. to build a dropdown of choices) — returns
// the set of ParkingSpace ids already booked over [start, end].
export async function findLockedSpaceIds(start: Date, end: Date, excludeRequestId?: string) {
  const bookings = await prisma.parkingRequest.findMany({
    where: {
      parkingSpaceId: { not: null },
      slotStatus: "Assigned",
      status: { not: "Cancelled" },
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      requiredStartDate: { lt: end },
      endDate: { gt: start },
    },
    select: { parkingSpaceId: true },
  });
  return new Set(bookings.map((b) => b.parkingSpaceId as string));
}

export async function wf05AssignSlot(requestId: string, actor: SessionPayload, parkingSpaceId: string) {
  if (actor.role !== "PARKING_MANAGEMENT") throw new WorkflowError("Only Parking Management can assign a slot.", 403);
  if (!parkingSpaceId?.trim()) throw new WorkflowError("A parking space is required.", 422);

  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status !== "Approved") throw new WorkflowError('Requires Status = "Approved".', 409);
    if (req.slotStatus === "Assigned") throw new WorkflowError("A slot is already assigned.", 409);

    const space = await tx.parkingSpace.findUnique({ where: { id: parkingSpaceId } });
    if (!space || !space.isActive) throw new WorkflowError("That parking space isn't available.", 404);

    const conflict = await findConflictingBooking(tx, parkingSpaceId, req.requiredStartDate, req.endDate, requestId);
    if (conflict) {
      throw new WorkflowError("That parking space is already booked for an overlapping period.", 409);
    }

    const assignedSlot = `${space.location} — ${space.slotNumber}`;

    await tx.parkingRequest.update({
      where: { id: requestId },
      data: {
        slotStatus: "Assigned",
        assignedSlot,
        parkingSpaceId,
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

// --- Developer-only — revert a request one phase backward --------------------------
//
// Only defined for statuses reached via exactly one forward transition:
// - Pending Approval <- WF02 endorse (from In Preparation), sole source.
// - Approved <- WF03 approve (from Pending Approval), sole source.
// - Completed <- WF06 (from Approved), sole source.
// "In Preparation" is deliberately NOT revertible — it's reachable from two
// different transitions (WF01's initial routing, and WF03's reject loop),
// so there's no single well-defined phase to revert TO. "Submitted" is
// never actually observed at rest (WF01 fires instantly on creation, see
// its comment above). "Cancelled" is terminal, same as Completed is for the
// normal forward flow — reverting either isn't in scope here.
// (REVERTIBLE_STATUSES itself lives in types.ts — RevertPhaseAction, a
// client component, needs it too, and this file pulls in server-only
// Prisma code that can't be bundled client-side.)

export async function wfDevRevertPhase(requestId: string, actor: SessionPayload) {
  if (actor.role !== "DEVELOPER") throw new WorkflowError("Only a Developer can revert a request's phase.", 403);

  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });

    if (req.status === "Pending Approval") {
      // Undo WF02 (In Preparation -> Pending Approval).
      const updated = await tx.parkingRequest.update({
        where: { id: requestId },
        data: { status: "In Preparation", approvalStage: "Prepared By", preparedById: null },
      });
      await logEvent(tx, requestId, "DEV_REVERT", "Pending Approval", "In Preparation", actor.sub, "Reverted 1 phase by Developer");
      return updated;
    }

    if (req.status === "Approved") {
      // Undo WF03 approve (Pending Approval -> Approved). Also strip
      // anything that's only valid while Approved (BR-006 payment/slot
      // tracks + the WF03 rate snapshot) — none of it belongs on a request
      // sitting at Pending Approval.
      const updated = await tx.parkingRequest.update({
        where: { id: requestId },
        data: {
          status: "Pending Approval",
          approvalStage: "Validated By",
          approvalDecision: null,
          validatedById: null,
          validatedDate: null,
          rateVersionId: null,
          rateAmountSnapshot: null,
          rateSnapshotDate: null,
          totalPaymentDue: null,
          paymentStatus: "Not Started",
          cashierId: null,
          payDate: null,
          officialReceiptReference: null,
          slotStatus: "Unassigned",
          assignedSlot: null,
          parkingSpaceId: null,
          slotAssignmentDate: null,
          assignedById: null,
        },
      });
      await logEvent(
        tx,
        requestId,
        "DEV_REVERT",
        "Approved",
        "Pending Approval",
        actor.sub,
        "Reverted 1 phase by Developer (payment/slot/rate snapshot cleared)"
      );
      return updated;
    }

    if (req.status === "Completed") {
      // Undo WF06 (Approved -> Completed). Payment/slot stay intact here —
      // they were legitimately confirmed while Approved; that's exactly
      // what triggered completion, so there's nothing to unwind.
      const updated = await tx.parkingRequest.update({
        where: { id: requestId },
        data: { status: "Approved", approvalStage: "Post-Approval", completedDate: null },
      });
      await logEvent(tx, requestId, "DEV_REVERT", "Completed", "Approved", actor.sub, "Reverted 1 phase by Developer");
      return updated;
    }

    throw new WorkflowError(`No previous phase to revert to from status "${req.status}".`, 409);
  });
}

// --- Cancellation (reachable from any non-terminal state) -------------------------

export async function cancelRequest(requestId: string, actor: SessionPayload) {
  return prisma.$transaction(async (tx) => {
    const req = await tx.parkingRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status === "Completed" || req.status === "Cancelled") {
      throw new WorkflowError(`Cannot cancel a request that is already ${req.status}.`, 409);
    }
    // Prepared By is deliberately excluded — they prepare/endorse or edit
    // details, but cancellation isn't their call to make. Requestors never
    // log in, so there's no owner-initiated path here either.
    if (actor.role === "PREPARED_BY") throw new WorkflowError("Not permitted to cancel this request.", 403);

    const updated = await tx.parkingRequest.update({
      where: { id: requestId },
      data: { status: "Cancelled" },
    });
    await logEvent(tx, requestId, "CANCEL", req.status, "Cancelled", actor.sub);
    return updated;
  });
}

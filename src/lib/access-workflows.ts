import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { WorkflowError } from "./workflows";
import type { SessionPayload } from "./auth";
import type { EnrollmentType, AccessRequestType, AccessType } from "./access-types";

type Tx = Prisma.TransactionClient;

async function logEvent(
  tx: Tx,
  requestId: string,
  workflow: string,
  fromStatus: string | null,
  toStatus: string | null,
  actorId: string | null,
  note?: string
) {
  await tx.accessRequestEvent.create({
    data: { requestId, workflow, fromStatus, toStatus, actorId, note },
  });
}

// --- Submission + AWF01 ------------------------------------------------------------

export type SubmitAccessRequestInput = {
  enrollmentType: EnrollmentType;
  requestType: AccessRequestType;
  transferTo?: string;
  transferFrom?: string;
  fullName: string;
  companyName: string;
  emailAddress: string;
  vehiclePlateNumber: string;
  propertyLocation: string;
  contactNumber: string;
  requestedQuantity: number;
  accessType: AccessType;
  remarks?: string;
  approverName?: string;
};

export async function submitAccessRequest(input: SubmitAccessRequestInput, requesterId: string) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.accessRequest.create({
      data: {
        enrollmentType: input.enrollmentType,
        requestType: input.requestType,
        transferTo: input.transferTo || null,
        transferFrom: input.transferFrom || null,
        fullName: input.fullName,
        companyName: input.companyName,
        emailAddress: input.emailAddress,
        vehiclePlateNumber: input.vehiclePlateNumber,
        propertyLocation: input.propertyLocation,
        contactNumber: input.contactNumber,
        requestedQuantity: input.requestedQuantity,
        accessType: input.accessType,
        remarks: input.remarks || null,
        approverName: input.approverName || null,
        status: "Submitted",
        requesterId,
      },
    });
    await logEvent(tx, created.id, "AWF01", null, "Submitted", requesterId, "Item created");
    return created;
  });
}

// --- AWF02 — Parking Management validates/endorses and issues the access ---------
// One combined action, matching the paper form's single "Validation of
// Document & Access Endorsement" box (checked/endorsed + qty + series +
// charge + OR number all together, not split across separate steps/roles).

export type ProcessAccessRequestInput = {
  confirmedQuantity: number;
  accessSeriesRef: string;
  purchasedCharge: number;
  officialReceiptRef: string;
  staffRemarks?: string;
};

export async function processAccessRequest(requestId: string, actor: SessionPayload, input: ProcessAccessRequestInput) {
  if (actor.role !== "PARKING_MANAGEMENT") {
    throw new WorkflowError("Only Parking Management can validate and endorse access requests.", 403);
  }
  if (!input.accessSeriesRef?.trim()) throw new WorkflowError("Access Series/Ref. is required.", 422);
  if (!input.officialReceiptRef?.trim()) throw new WorkflowError("Official Receipt No. is required.", 422);

  return prisma.$transaction(async (tx) => {
    const req = await tx.accessRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status !== "Submitted") {
      throw new WorkflowError(`AWF02 requires Status = "Submitted" (current: "${req.status}").`, 409);
    }

    const updated = await tx.accessRequest.update({
      where: { id: requestId },
      data: {
        status: "Processed",
        processedById: actor.sub,
        processedDate: new Date(),
        confirmedQuantity: input.confirmedQuantity,
        accessSeriesRef: input.accessSeriesRef,
        purchasedCharge: input.purchasedCharge,
        officialReceiptRef: input.officialReceiptRef,
        staffRemarks: input.staffRemarks || null,
      },
    });
    await logEvent(tx, requestId, "AWF02", "Submitted", "Processed", actor.sub, `Access series ${input.accessSeriesRef}`);
    return updated;
  });
}

// --- AWF03 — client confirmed receipt, recorded by staff (no client login) -------

export async function completeAccessRequest(requestId: string, actor: SessionPayload, receivedByName: string) {
  if (actor.role !== "PARKING_MANAGEMENT") {
    throw new WorkflowError("Only Parking Management can confirm the client received the access.", 403);
  }
  if (!receivedByName?.trim()) throw new WorkflowError("Received By name is required.", 422);

  return prisma.$transaction(async (tx) => {
    const req = await tx.accessRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status !== "Processed") {
      throw new WorkflowError(`AWF03 requires Status = "Processed" (current: "${req.status}").`, 409);
    }

    const updated = await tx.accessRequest.update({
      where: { id: requestId },
      data: { status: "Completed", completedById: actor.sub, completedDate: new Date(), receivedByName },
    });
    await logEvent(tx, requestId, "AWF03", "Processed", "Completed", actor.sub, `Received by ${receivedByName}`);
    return updated;
  });
}

// --- Cancellation (reachable from any non-terminal state, any staff role) --------

export async function cancelAccessRequest(requestId: string, actor: SessionPayload) {
  return prisma.$transaction(async (tx) => {
    const req = await tx.accessRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (req.status === "Completed" || req.status === "Cancelled") {
      throw new WorkflowError(`Cannot cancel a request that is already ${req.status}.`, 409);
    }

    const updated = await tx.accessRequest.update({
      where: { id: requestId },
      data: { status: "Cancelled", cancelledById: actor.sub, cancelledDate: new Date() },
    });
    await logEvent(tx, requestId, "CANCEL", req.status, "Cancelled", actor.sub);
    return updated;
  });
}

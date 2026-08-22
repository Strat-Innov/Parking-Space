import { repos } from "./data";
import { WorkflowError } from "./workflows";
import type { SessionPayload } from "./auth";
import type { EnrollmentType, AccessRequestType, AccessType } from "./access-types";

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
  return repos.accessRequests.create(
    {
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
    {
      event: {
        workflow: "AWF01",
        fromStatus: null,
        toStatus: "Submitted",
        actorId: requesterId,
        note: "Item created",
      },
    },
  );
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

export async function processAccessRequest(
  requestId: string,
  actor: SessionPayload,
  input: ProcessAccessRequestInput,
) {
  if (actor.role !== "PARKING_MANAGEMENT") {
    throw new WorkflowError("Only Parking Management can validate and endorse access requests.", 403);
  }
  if (!input.accessSeriesRef?.trim()) throw new WorkflowError("Access Series/Ref. is required.", 422);
  if (!input.officialReceiptRef?.trim()) throw new WorkflowError("Official Receipt No. is required.", 422);

  return repos.accessRequests.transition(requestId, {
    plan: (req) => {
      if (req.status !== "Submitted") {
        throw new WorkflowError(`Requires Status = "Submitted" (current: "${req.status}").`, 409);
      }
      return {
        patch: {
          status: "Processed",
          processedById: actor.sub,
          processedDate: new Date(),
          confirmedQuantity: input.confirmedQuantity,
          accessSeriesRef: input.accessSeriesRef,
          purchasedCharge: input.purchasedCharge,
          officialReceiptRef: input.officialReceiptRef,
          staffRemarks: input.staffRemarks || null,
        },
        event: {
          workflow: "AWF02",
          fromStatus: "Submitted",
          toStatus: "Processed",
          actorId: actor.sub,
          note: `Access series ${input.accessSeriesRef}`,
        },
      };
    },
  });
}

// --- AWF03 — client confirmed receipt, recorded by staff (no client login) -------

export async function completeAccessRequest(requestId: string, actor: SessionPayload, receivedByName: string) {
  if (actor.role !== "PARKING_MANAGEMENT") {
    throw new WorkflowError("Only Parking Management can confirm the client received the access.", 403);
  }
  if (!receivedByName?.trim()) throw new WorkflowError("Received By name is required.", 422);

  return repos.accessRequests.transition(requestId, {
    plan: (req) => {
      if (req.status !== "Processed") {
        throw new WorkflowError(`Requires Status = "Processed" (current: "${req.status}").`, 409);
      }
      return {
        patch: {
          status: "Completed",
          completedById: actor.sub,
          completedDate: new Date(),
          receivedByName,
        },
        event: {
          workflow: "AWF03",
          fromStatus: "Processed",
          toStatus: "Completed",
          actorId: actor.sub,
          note: `Received by ${receivedByName}`,
        },
      };
    },
  });
}

// --- Cancellation (reachable from any non-terminal state, any staff role) --------
//
// NOTE: unlike Parking Space cancellation (see cancelRequest in workflows.ts,
// which refuses PREPARED_BY), this one has no role restriction at all. That
// asymmetry is existing, tested behaviour and is preserved deliberately —
// harmonising the two would be a business-rule change, not a migration.

export async function cancelAccessRequest(requestId: string, actor: SessionPayload) {
  return repos.accessRequests.transition(requestId, {
    plan: (req) => {
      if (req.status === "Completed" || req.status === "Cancelled") {
        throw new WorkflowError(`Cannot cancel a request that is already ${req.status}.`, 409);
      }
      return {
        patch: { status: "Cancelled", cancelledById: actor.sub, cancelledDate: new Date() },
        event: {
          workflow: "CANCEL",
          fromStatus: req.status,
          toStatus: "Cancelled",
          actorId: actor.sub,
          note: null,
        },
      };
    },
  });
}

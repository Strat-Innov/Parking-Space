// Central enum definitions. These are the ONLY allowed values for their
// respective columns (Prisma stores them as plain strings — see schema.prisma
// header comment). BR-008: Status and ApprovalStage are deliberately
// disjoint types; nothing may merge them.

export const ROLES = [
  "REQUESTER",
  "PREPARED_BY",
  "VALIDATED_BY",
  "CASHIER",
  "PARKING_MANAGEMENT",
] as const;
export type Role = (typeof ROLES)[number];

export const SERVICE_TYPES = ["Hourly", "Daily", "Monthly"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

// Section 2 — Rejected is deliberately NOT a resting Status value (see doc).
export const STATUSES = [
  "Submitted",
  "In Preparation",
  "Pending Approval",
  "Approved",
  "Completed",
  "Cancelled",
] as const;
export type Status = (typeof STATUSES)[number];

// Section 4
export const APPROVAL_STAGES = [
  "Prepared By",
  "Validated By",
  "Post-Approval",
  "Completed",
] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

export const PAYMENT_STATUSES = ["Not Started", "Pending", "Confirmed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const SLOT_STATUSES = ["Unassigned", "Assigned"] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export const NON_TERMINAL_STATUSES: Status[] = [
  "Submitted",
  "In Preparation",
  "Pending Approval",
  "Approved",
];

export const ROLE_LABELS: Record<Role, string> = {
  REQUESTER: "Requester",
  PREPARED_BY: "Prepared By",
  VALIDATED_BY: "Validated By",
  CASHIER: "Cashier",
  PARKING_MANAGEMENT: "Parking Management",
};

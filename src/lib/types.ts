// Central enum definitions. These are the ONLY allowed values for their
// respective columns (Prisma stores them as plain strings — see schema.prisma
// header comment). BR-008: Status and ApprovalStage are deliberately
// disjoint types; nothing may merge them.

// CASHIER is retired — WF04 payment confirmation moved to Prepared By (an
// inline field edit, not a separate role). Historical RequestEvent/User rows
// may still carry the literal string "CASHIER"; that's fine since those are
// plain strings, not a DB enum, and Timeline displays actor.role verbatim
// rather than through ROLE_LABELS.
// DEVELOPER is a separate admin-style role, not a peer of the 3 workflow
// roles: it owns account management (deactivate/reactivate — add/invite
// stays open to any staff member, unchanged) and reverting a request one
// phase backward (see wf_devRevertPhase in workflows.ts). It does NOT grant
// the regular WF02/WF03/WF04/WF05/cancel actions — those still check for
// their own specific role, so a Developer account can view a request but
// not act on its normal workflow. Deliberately excluded from STAFF_ROLES so
// it never appears in the public/staff account-creation role dropdowns —
// granting it is a manual, one-off action, not self-service.
export const ROLES = ["REQUESTER", "PREPARED_BY", "VALIDATED_BY", "PARKING_MANAGEMENT", "DEVELOPER"] as const;
export type Role = (typeof ROLES)[number];

// The roles a new account can actually be created as — every ordinary
// login-capable role except REQUESTER, which only ever exists as an
// auto-created guest row (see src/lib/guest.ts) and is blocked from logging
// in entirely. DEVELOPER is intentionally not here (see comment above).
export const STAFF_ROLES = ["PREPARED_BY", "VALIDATED_BY", "PARKING_MANAGEMENT"] as const;

// Every role a Developer can assign — via Add Account, Invite, or editing an
// existing account's role. Same reasoning as STAFF_ROLES excluding
// REQUESTER; DEVELOPER is included here (grantable) but still excluded from
// STAFF_ROLES (never self-service).
export const ASSIGNABLE_ROLES = [...STAFF_ROLES, "DEVELOPER"] as const;

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

// Statuses wfDevRevertPhase (workflows.ts) can revert one step backward from
// — kept here (not workflows.ts) since it's imported by a client component
// (RevertPhaseAction) and workflows.ts pulls in server-only Prisma code.
// See wfDevRevertPhase's comment for why exactly these three and not
// "In Preparation"/"Submitted"/"Cancelled".
export const REVERTIBLE_STATUSES: Status[] = ["Pending Approval", "Approved", "Completed"];

export const ROLE_LABELS: Record<Role, string> = {
  REQUESTER: "Requestor",
  PREPARED_BY: "Prepared By",
  VALIDATED_BY: "Validated By",
  PARKING_MANAGEMENT: "Parking Management",
  DEVELOPER: "Developer",
};

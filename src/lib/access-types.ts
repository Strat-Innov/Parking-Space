// Enum definitions for Parking Access (RFID/Card/Metal Tag enrollment) —
// mirrors the field/label conventions in src/lib/types.ts. Roles are
// shared with Parking Space (see schema.prisma comment on AccessRequest);
// nothing new is defined here for those.

export const ENROLLMENT_TYPES = ["Individual", "Corporate"] as const;
export type EnrollmentType = (typeof ENROLLMENT_TYPES)[number];

export const ACCESS_REQUEST_TYPES = [
  "New Enrollment",
  "Replacement",
  "Deactivation/Cancellation",
  "Renewal",
  "Reactivation",
  "Transfer",
] as const;
export type AccessRequestType = (typeof ACCESS_REQUEST_TYPES)[number];

export const ACCESS_TYPES = ["RFID Sticker/Card/Metal Tag", "Manual Pass"] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

export const ACCESS_STATUSES = ["Submitted", "Processed", "Completed", "Cancelled"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export const ACCESS_NON_TERMINAL_STATUSES: AccessStatus[] = ["Submitted", "Processed"];

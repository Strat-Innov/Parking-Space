// Domain record types — hand-written, deliberately independent of
// @prisma/client so that application code (workflows, routes, pages) does not
// import the ORM's generated types. They are field-for-field identical to
// prisma/schema.prisma today; `type-parity.ts` enforces that at compile time,
// so the schema and these definitions cannot drift apart silently.
//
// Phase 1 keeps Prisma as the only implementation. Nothing here describes a
// SharePoint concept.

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: Date;
  roles: string[];
  emailVerifiedAt: Date | null;
  emailVerificationToken: string | null;
  emailVerificationTokenExpiresAt: Date | null;
  hasPassword: boolean;
  active: boolean;
}

export interface ParkingRequestRecord {
  id: string;

  // Section 5 — intake
  fullName: string;
  companyName: string;
  emailAddress: string;
  serviceType: string;
  preferredParkingLocation: string;
  requestedSlot: string | null;
  dateOfRequest: Date;
  requiredStartDate: Date;
  endDate: Date;
  purpose: string;

  // Section 2 / Section 4 — lifecycle
  status: string;
  approvalStage: string;

  // BR-006 parallel tracks
  paymentStatus: string;
  slotStatus: string;

  // WF02
  preparedById: string | null;

  // WF03
  validatedById: string | null;
  approvalDecision: string | null;
  validatedDate: Date | null;

  // WF03 reject branch — Section 8 audit
  rejectionCount: number;
  rejectionReason: string | null;
  rejectedById: string | null;
  rejectedDate: Date | null;

  // WF04
  cashierId: string | null;
  payDate: Date | null;
  officialReceiptReference: string | null;

  // WF05
  assignedSlot: string | null;
  parkingSpaceId: string | null;
  slotAssignmentDate: Date | null;
  assignedById: string | null;

  // computed at submission
  totalHours: number | null;
  totalDays: number | null;
  totalMonths: number | null;

  // Section 7 — rate snapshot
  rateVersionId: string | null;
  rateAmountSnapshot: number | null;
  rateSnapshotDate: Date | null;
  totalPaymentDue: number | null;

  // WF06
  completedDate: Date | null;

  requesterId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RateTableEntryRecord {
  id: string;
  serviceType: string;
  chargingModel: string;
  rateAmount: number;
  effectiveStartDate: Date;
  effectiveEndDate: Date | null;
  createdById: string | null;
  createdAt: Date;
}

export interface ParkingSpaceRecord {
  id: string;
  location: string;
  slotNumber: string;
  isActive: boolean;
  createdById: string | null;
  createdAt: Date;
}

export interface RequestEventRecord {
  id: string;
  requestId: string;
  workflow: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface AccessRequestRecord {
  id: string;

  enrollmentType: string;
  requestType: string;
  transferTo: string | null;
  transferFrom: string | null;

  fullName: string;
  companyName: string;
  emailAddress: string;
  vehiclePlateNumber: string;
  propertyLocation: string;
  contactNumber: string;
  dateOfRequest: Date;
  requestedQuantity: number;
  accessType: string;
  remarks: string | null;
  approverName: string | null;

  status: string;

  processedById: string | null;
  processedDate: Date | null;
  confirmedQuantity: number | null;
  accessSeriesRef: string | null;
  purchasedCharge: number | null;
  officialReceiptRef: string | null;
  staffRemarks: string | null;

  receivedByName: string | null;
  completedById: string | null;
  completedDate: Date | null;

  cancelledById: string | null;
  cancelledDate: Date | null;

  requesterId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccessRequestEventRecord {
  id: string;
  requestId: string;
  workflow: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  note: string | null;
  createdAt: Date;
}

// --- hydrated projections -------------------------------------------------
//
// The exact shapes the current `include:` clauses produce. Keeping them named
// means UI and route code sees no difference when the backend changes.

export type NamedRef = { name: string };
export type NamedEmailRef = { name: string; email: string };
export type ActorRef = { name: string; role: string };

export type RequestEventWithActor = RequestEventRecord & { actor: ActorRef | null };
export type AccessRequestEventWithActor = AccessRequestEventRecord & { actor: ActorRef | null };

export type ParkingRequestWithRequesterName = ParkingRequestRecord & { requester: NamedRef };
export type ParkingRequestWithRequesterContact = ParkingRequestRecord & { requester: NamedEmailRef };

export type ParkingRequestForExport = ParkingRequestRecord & {
  preparedBy: NamedRef | null;
  validatedBy: NamedRef | null;
};

export type ParkingRequestDetail = ParkingRequestRecord & {
  requester: NamedEmailRef;
  preparedBy: NamedRef | null;
  validatedBy: NamedRef | null;
  rejectedBy: NamedRef | null;
  cashier: NamedRef | null;
  assignedBy: NamedRef | null;
  rateVersion: RateTableEntryRecord | null;
  events: RequestEventWithActor[];
};

export type AccessRequestWithRequesterName = AccessRequestRecord & { requester: NamedRef };
export type AccessRequestWithRequesterContact = AccessRequestRecord & { requester: NamedEmailRef };

export type AccessRequestDetail = AccessRequestRecord & {
  requester: NamedEmailRef;
  processedBy: NamedRef | null;
  completedBy: NamedRef | null;
  cancelledBy: NamedRef | null;
  events: AccessRequestEventWithActor[];
};

export type ParkingSpaceWithCreator = ParkingSpaceRecord & { createdBy: NamedRef | null };
export type RateTableEntryWithCreator = RateTableEntryRecord & { createdBy: NamedRef | null };

/** The projection the parking-locations page buckets per space. */
export type SpaceBookingSummary = {
  parkingSpaceId: string | null;
  companyName: string;
  serviceType: string;
  requiredStartDate: Date;
  endDate: Date;
};

export type AccountSummary = Pick<UserRecord, "id" | "name" | "email" | "role" | "createdAt">;
export type AccountWithRoles = Pick<UserRecord, "id" | "name" | "email" | "role" | "roles">;

// --- write inputs ---------------------------------------------------------

export type NewUserInput = {
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  roles?: string[];
  emailVerifiedAt?: Date | null;
  emailVerificationToken?: string | null;
  emailVerificationTokenExpiresAt?: Date | null;
  hasPassword?: boolean;
  active?: boolean;
};

export type NewParkingRequestInput = {
  fullName: string;
  companyName: string;
  emailAddress: string;
  serviceType: string;
  preferredParkingLocation: string;
  requestedSlot: string | null;
  dateOfRequest: Date;
  requiredStartDate: Date;
  endDate: Date;
  purpose: string;
  status: string;
  approvalStage: string;
  requesterId: string;
  totalHours: number | null;
  totalDays: number | null;
  totalMonths: number | null;
};

export type NewAccessRequestInput = {
  enrollmentType: string;
  requestType: string;
  transferTo: string | null;
  transferFrom: string | null;
  fullName: string;
  companyName: string;
  emailAddress: string;
  vehiclePlateNumber: string;
  propertyLocation: string;
  contactNumber: string;
  requestedQuantity: number;
  accessType: string;
  remarks: string | null;
  approverName: string | null;
  status: string;
  requesterId: string;
};

export type NewRateEntryInput = {
  serviceType: string;
  chargingModel: string;
  rateAmount: number;
  effectiveStartDate: Date;
  effectiveEndDate?: Date | null;
  createdById: string | null;
};

export type NewParkingSpaceInput = {
  location: string;
  slotNumber: string;
  createdById: string | null;
};

/** Event rows are append-only; `requestId` is supplied by the repository. */
export type NewEventInput = {
  workflow: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  note?: string | null;
};

/**
 * An atomic numeric adjustment. Preserved as a distinct concept rather than
 * being flattened to `current + 1` because the underlying store may implement
 * it atomically (Postgres does), and losing that would change concurrency
 * behaviour, not just style. See rejectionCount in WF03's reject branch.
 */
export type NumericDelta = { increment: number };

/** A field patch, allowing an atomic delta wherever the field is a plain number. */
export type Patch<T> = {
  [K in keyof T]?: T[K] extends number ? T[K] | NumericDelta : T[K];
};

export type ParkingRequestPatch = Patch<ParkingRequestRecord>;
export type AccessRequestPatch = Patch<AccessRequestRecord>;
export type UserPatch = Partial<Omit<UserRecord, "id" | "createdAt">>;
export type ParkingSpacePatch = Partial<Omit<ParkingSpaceRecord, "id" | "createdAt">>;

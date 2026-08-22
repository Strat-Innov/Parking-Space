// Repository interfaces — the seam the SharePoint migration will swap.
//
// Phase 1 introduces this boundary with Prisma behind it and changes no
// behaviour. Nothing here mentions SharePoint, Graph, or ETags.
//
// ON ATOMICITY (see MIGRATION_ARCHITECTURE.md §8): `transition` and `create`
// are NOT declared as transaction boundaries. The Prisma implementation runs
// each of them, including any `andThen` chain, inside one real transaction —
// which is what the application relies on today and what Phase 1 preserves
// exactly. A future SharePoint implementation cannot offer that, and the
// interface deliberately does not promise it, so callers must not assume the
// stronger guarantee.

import type {
  AccessRequestDetail,
  AccessRequestEventRecord,
  AccessRequestPatch,
  AccessRequestRecord,
  AccessRequestWithRequesterContact,
  AccessRequestWithRequesterName,
  AccountSummary,
  AccountWithRoles,
  NewAccessRequestInput,
  NewEventInput,
  NewParkingRequestInput,
  NewParkingSpaceInput,
  NewRateEntryInput,
  NewUserInput,
  ParkingRequestDetail,
  ParkingRequestForExport,
  ParkingRequestPatch,
  ParkingRequestRecord,
  ParkingRequestWithRequesterContact,
  ParkingRequestWithRequesterName,
  ParkingSpacePatch,
  ParkingSpaceRecord,
  ParkingSpaceWithCreator,
  RateTableEntryRecord,
  RateTableEntryWithCreator,
  RequestEventWithActor,
  SpaceBookingSummary,
  UserPatch,
  UserRecord,
} from "./types";

// --- the guarded-transition primitive -------------------------------------

/**
 * The reads a transition may perform *within its own unit of work*.
 *
 * Deliberately a fixed, named set rather than a general query handle: these
 * are exactly the secondary lookups the workflows need (WF03's rate
 * resolution, WF05's space lookup and overlap check). Under Prisma they run
 * inside the transaction, which is what serialises two concurrent slot
 * assignments today.
 */
export interface TransitionReads {
  resolveCurrentRate(serviceType: string, asOf: Date): Promise<RateTableEntryRecord | null>;
  findParkingSpaceById(id: string): Promise<ParkingSpaceRecord | null>;
  findConflictingBooking(query: BookingWindowQuery): Promise<ParkingRequestRecord | null>;
}

export type TransitionPlan<P> = {
  patch: P;
  event: NewEventInput;
};

export type TransitionSpec<T, P> = {
  /**
   * Decides what this transition does, given the record as freshly read inside
   * the unit of work. Throw a WorkflowError to abort — every precondition
   * (status guard, ownership, availability) belongs here.
   *
   * Must be free of side effects outside the unit of work: an implementation
   * may re-run it after a concurrency conflict.
   */
  plan: (current: T, reads: TransitionReads) => Promise<TransitionPlan<P>> | TransitionPlan<P>;
  /**
   * A follow-on transition evaluated against the updated record, inside the
   * same unit of work. Returning null ends the chain. This is how WF04 and
   * WF05 hand off to WF06 without either of them writing `Completed`.
   */
  andThen?: (updated: T) => TransitionSpec<T, P> | null;
};

export type ParkingRequestTransition = TransitionSpec<ParkingRequestRecord, ParkingRequestPatch>;
export type AccessRequestTransition = TransitionSpec<AccessRequestRecord, AccessRequestPatch>;

export type CreateWithEvent<T, P> = {
  /** The event recorded for the creation itself. */
  event: NewEventInput;
  /** An immediately-following transition, in the same unit of work. */
  andThen?: (created: T) => TransitionSpec<T, P> | null;
};

export type BookingWindowQuery = {
  parkingSpaceId: string;
  start: Date;
  end: Date;
  excludeRequestId?: string;
};

// --- repositories ---------------------------------------------------------

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByIdOrThrow(id: string): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findByVerificationToken(token: string): Promise<UserRecord | null>;
  /** Ordered by createdAt desc, matching the accounts list today. */
  listByRoles(roles: readonly string[]): Promise<UserRecord[]>;
  listSummariesByRoles(roles: readonly string[]): Promise<AccountSummary[]>;
  create(input: NewUserInput): Promise<UserRecord>;
  update(id: string, patch: UserPatch): Promise<UserRecord>;
  updateRoles(id: string, role: string, roles: string[]): Promise<AccountWithRoles>;
  delete(id: string): Promise<void>;
  /**
   * Clears attribution-only references (rate/space authorship) and deletes the
   * account, as one unit of work. Workflow history is NOT cleared — an account
   * carrying any is refused by the caller before reaching here.
   */
  deleteWithAttributionCleared(id: string): Promise<void>;
  /** Per-relation counts of real workflow involvement; {} for an unknown id. */
  countWorkflowHistory(userId: string): Promise<Record<string, number>>;
  /**
   * Resolves the requester for a public submission: returns the id of the
   * existing account with this email if there is one — which may be a STAFF
   * account, not only a guest row — and otherwise creates a REQUESTER row with
   * an unusable password hash.
   *
   * Named for what it does rather than "findOrCreateGuest", because reusing an
   * existing staff account is a real, tested behaviour, not an edge case.
   */
  resolveRequesterForSubmission(fullName: string, emailAddress: string): Promise<string>;
}

export interface ParkingRequestRepository {
  transition(id: string, spec: ParkingRequestTransition): Promise<ParkingRequestRecord>;
  create(
    input: NewParkingRequestInput,
    opts: CreateWithEvent<ParkingRequestRecord, ParkingRequestPatch>,
  ): Promise<ParkingRequestRecord>;

  findById(id: string): Promise<ParkingRequestRecord | null>;
  findDetailById(id: string): Promise<ParkingRequestDetail | null>;
  findForExportById(id: string): Promise<ParkingRequestForExport | null>;

  listAllWithRequesterName(): Promise<ParkingRequestWithRequesterName[]>;
  listAllWithRequesterContact(): Promise<ParkingRequestWithRequesterContact[]>;
  listAllForExport(): Promise<ParkingRequestForExport[]>;
  listActiveBookingsFrom(from: Date): Promise<SpaceBookingSummary[]>;

  countByParkingSpace(parkingSpaceId: string): Promise<number>;
  countByRateVersion(rateVersionId: string): Promise<number>;

  /** Ids of spaces already booked over [start, end); used to build dropdowns. */
  findLockedSpaceIds(start: Date, end: Date, excludeRequestId?: string): Promise<Set<string>>;
  findUpcomingBookingForSpace(parkingSpaceId: string, from: Date): Promise<ParkingRequestRecord | null>;

  /** Removes the request and its events. Developer-only, permanent. */
  deleteWithEvents(id: string): Promise<void>;
}

export interface RequestEventRepository {
  listForRequest(requestId: string): Promise<RequestEventWithActor[]>;
}

export interface AccessRequestRepository {
  transition(id: string, spec: AccessRequestTransition): Promise<AccessRequestRecord>;
  create(
    input: NewAccessRequestInput,
    opts: CreateWithEvent<AccessRequestRecord, AccessRequestPatch>,
  ): Promise<AccessRequestRecord>;

  findById(id: string): Promise<AccessRequestRecord | null>;
  findDetailById(id: string): Promise<AccessRequestDetail | null>;
  listAllWithRequesterName(): Promise<AccessRequestWithRequesterName[]>;
  listAllWithRequesterContact(): Promise<AccessRequestWithRequesterContact[]>;
}

export interface AccessRequestEventRepository {
  listForRequest(requestId: string): Promise<AccessRequestEventRecord[]>;
}

export interface RateTableRepository {
  listAll(): Promise<RateTableEntryWithCreator[]>;
  findById(id: string): Promise<RateTableEntryRecord | null>;
  create(input: NewRateEntryInput): Promise<RateTableEntryRecord>;
  delete(id: string): Promise<void>;
  // NOTE: no update(). The rate table is append-only by design (Section 7) —
  // a rate change is a new row. Withholding the method makes that structural
  // rather than a convention someone can forget.
}

export interface ParkingSpaceRepository {
  listAll(): Promise<ParkingSpaceWithCreator[]>;
  listActive(): Promise<ParkingSpaceRecord[]>;
  listDistinctActiveLocations(): Promise<string[]>;
  findById(id: string): Promise<ParkingSpaceRecord | null>;
  findActiveByLocationAndSlot(location: string, slotNumber: string): Promise<ParkingSpaceRecord | null>;
  findActiveSlotNumbers(location: string, slotNumbers: string[]): Promise<Set<string>>;
  create(input: NewParkingSpaceInput): Promise<ParkingSpaceRecord>;
  createMany(inputs: NewParkingSpaceInput[]): Promise<number>;
  update(id: string, patch: ParkingSpacePatch): Promise<ParkingSpaceRecord>;
  delete(id: string): Promise<void>;
}

export interface Repositories {
  users: UserRepository;
  parkingRequests: ParkingRequestRepository;
  requestEvents: RequestEventRepository;
  accessRequests: AccessRequestRepository;
  accessRequestEvents: AccessRequestEventRepository;
  rateTable: RateTableRepository;
  parkingSpaces: ParkingSpaceRepository;
}

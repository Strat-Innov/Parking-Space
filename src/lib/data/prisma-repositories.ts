// Prisma-backed implementation of the repository interfaces.
//
// This is the ONLY file in the application that issues Prisma queries. Its job
// in Phase 1 is to reproduce today's behaviour exactly, including transaction
// boundaries — every `transition` and `create`, and any `andThen` chained onto
// them, runs inside one real `prisma.$transaction`, exactly as the workflow
// code did when it held the transaction itself.

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { unusablePasswordHash } from "../password";
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
import type {
  AccessRequestEventRepository,
  AccessRequestRepository,
  AccessRequestTransition,
  BookingWindowQuery,
  CreateWithEvent,
  ParkingRequestRepository,
  ParkingRequestTransition,
  ParkingSpaceRepository,
  RateTableRepository,
  Repositories,
  RequestEventRepository,
  TransitionReads,
  UserRepository,
} from "./repositories";

type Tx = Prisma.TransactionClient;

const NAME = { select: { name: true } } as const;
const NAME_EMAIL = { select: { name: true, email: true } } as const;
const ACTOR = { select: { name: true, role: true } } as const;

const REQUEST_DETAIL_INCLUDE = {
  requester: NAME_EMAIL,
  preparedBy: NAME,
  validatedBy: NAME,
  rejectedBy: NAME,
  cashier: NAME,
  assignedBy: NAME,
  rateVersion: true,
  events: { orderBy: { createdAt: "asc" }, include: { actor: ACTOR } },
} satisfies Prisma.ParkingRequestInclude;

const ACCESS_DETAIL_INCLUDE = {
  requester: NAME_EMAIL,
  processedBy: NAME,
  completedBy: NAME,
  cancelledBy: NAME,
  events: { orderBy: { createdAt: "asc" }, include: { actor: ACTOR } },
} satisfies Prisma.AccessRequestInclude;

const EXPORT_INCLUDE = { preparedBy: NAME, validatedBy: NAME } satisfies Prisma.ParkingRequestInclude;

const ACCOUNT_SUMMARY_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

/**
 * The workflow-history relations that represent real involvement and therefore
 * block deletion. Rate-table and parking-space authorship are deliberately
 * absent: they are attribution only, and are nulled out instead.
 */
const WORKFLOW_HISTORY_SELECT = {
  requestsSubmitted: true,
  requestsPrepared: true,
  requestsValidated: true,
  requestsRejected: true,
  requestsCashiered: true,
  requestsAssigned: true,
  events: true,
  accessRequestsSubmitted: true,
  accessRequestsProcessed: true,
  accessRequestsCompleted: true,
  accessRequestsCancelled: true,
  accessEvents: true,
} satisfies Prisma.UserCountOutputTypeSelect;

/** The secondary reads a transition may make, bound to its own transaction. */
function readsFor(tx: Tx): TransitionReads {
  return {
    resolveCurrentRate: (serviceType, asOf) =>
      tx.rateTableEntry.findFirst({
        where: { serviceType, effectiveStartDate: { lte: asOf } },
        orderBy: { effectiveStartDate: "desc" },
      }),
    findParkingSpaceById: (id) => tx.parkingSpace.findUnique({ where: { id } }),
    findConflictingBooking: (q) => tx.parkingRequest.findFirst({ where: bookingConflictWhere(q) }),
  };
}

function bookingConflictWhere({
  parkingSpaceId,
  start,
  end,
  excludeRequestId,
}: BookingWindowQuery): Prisma.ParkingRequestWhereInput {
  return {
    parkingSpaceId,
    slotStatus: "Assigned",
    status: { not: "Cancelled" },
    ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
    requiredStartDate: { lt: end },
    endDate: { gt: start },
  };
}

function eventData(requestId: string, event: NewEventInput) {
  return {
    requestId,
    workflow: event.workflow,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    actorId: event.actorId,
    note: event.note ?? null,
  };
}

// --- transition chains ----------------------------------------------------
//
// One read, one plan, one update, one event append — then recurse into any
// `andThen`. All of it inside the caller's transaction, so a chain such as
// WF04 -> WF06 commits or rolls back as a single unit, exactly as before.

async function runParkingChain(
  tx: Tx,
  id: string,
  spec: ParkingRequestTransition,
): Promise<ParkingRequestRecord> {
  const current = await tx.parkingRequest.findUniqueOrThrow({ where: { id } });
  const { patch, event } = await spec.plan(current, readsFor(tx));
  const updated = await tx.parkingRequest.update({
    where: { id },
    data: patch as Prisma.ParkingRequestUncheckedUpdateInput,
  });
  await tx.requestEvent.create({ data: eventData(id, event) });

  const next = spec.andThen?.(updated) ?? null;
  return next ? runParkingChain(tx, id, next) : updated;
}

async function runAccessChain(
  tx: Tx,
  id: string,
  spec: AccessRequestTransition,
): Promise<AccessRequestRecord> {
  const current = await tx.accessRequest.findUniqueOrThrow({ where: { id } });
  const { patch, event } = await spec.plan(current, readsFor(tx));
  const updated = await tx.accessRequest.update({
    where: { id },
    data: patch as Prisma.AccessRequestUncheckedUpdateInput,
  });
  await tx.accessRequestEvent.create({ data: eventData(id, event) });

  const next = spec.andThen?.(updated) ?? null;
  return next ? runAccessChain(tx, id, next) : updated;
}

// --- users ----------------------------------------------------------------

const users: UserRepository = {
  findById: (id) => prisma.user.findUnique({ where: { id } }),
  findByIdOrThrow: (id) => prisma.user.findUniqueOrThrow({ where: { id } }),
  findByEmail: (email) => prisma.user.findUnique({ where: { email } }),
  findByVerificationToken: (token) =>
    prisma.user.findUnique({ where: { emailVerificationToken: token } }),

  listByRoles: (roles) =>
    prisma.user.findMany({
      where: { role: { in: roles as string[] } },
      orderBy: { createdAt: "desc" },
    }),

  listSummariesByRoles: (roles): Promise<AccountSummary[]> =>
    prisma.user.findMany({
      where: { role: { in: roles as string[] } },
      orderBy: { createdAt: "desc" },
      select: ACCOUNT_SUMMARY_SELECT,
    }),

  create: (input: NewUserInput): Promise<UserRecord> => prisma.user.create({ data: input }),

  update: (id, patch: UserPatch): Promise<UserRecord> =>
    prisma.user.update({ where: { id }, data: patch }),

  updateRoles: (id, role, roles): Promise<AccountWithRoles> =>
    prisma.user.update({
      where: { id },
      data: { role, roles },
      select: { id: true, name: true, email: true, role: true, roles: true },
    }),

  delete: async (id) => {
    await prisma.user.delete({ where: { id } });
  },

  deleteWithAttributionCleared: async (id) => {
    await prisma.$transaction([
      prisma.rateTableEntry.updateMany({ where: { createdById: id }, data: { createdById: null } }),
      prisma.parkingSpace.updateMany({ where: { createdById: id }, data: { createdById: null } }),
      prisma.user.delete({ where: { id } }),
    ]);
  },

  countWorkflowHistory: async (userId) => {
    const counts = await prisma.user.findUnique({
      where: { id: userId },
      select: { _count: { select: WORKFLOW_HISTORY_SELECT } },
    });
    return counts?._count ?? {};
  },

  // Found-or-created by email. An existing account of ANY role is reused — a
  // staff member submitting through the public form is attributed to their own
  // account rather than getting a duplicate guest row.
  resolveRequesterForSubmission: async (fullName, emailAddress) => {
    const email = emailAddress.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return existing.id;

    const created = await prisma.user.create({
      data: { name: fullName, email, role: "REQUESTER", passwordHash: await unusablePasswordHash() },
    });
    return created.id;
  },
};

// --- parking requests -----------------------------------------------------

const parkingRequests: ParkingRequestRepository = {
  transition: (id, spec) => prisma.$transaction((tx) => runParkingChain(tx, id, spec)),

  create: (input: NewParkingRequestInput, opts: CreateWithEvent<ParkingRequestRecord, ParkingRequestPatch>) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.parkingRequest.create({ data: input });
      await tx.requestEvent.create({ data: eventData(created.id, opts.event) });

      const next = opts.andThen?.(created) ?? null;
      return next ? runParkingChain(tx, created.id, next) : created;
    }),

  findById: (id) => prisma.parkingRequest.findUnique({ where: { id } }),

  findDetailById: (id): Promise<ParkingRequestDetail | null> =>
    prisma.parkingRequest.findUnique({ where: { id }, include: REQUEST_DETAIL_INCLUDE }),

  findForExportById: (id): Promise<ParkingRequestForExport | null> =>
    prisma.parkingRequest.findUnique({ where: { id }, include: EXPORT_INCLUDE }),

  listAllWithRequesterName: (): Promise<ParkingRequestWithRequesterName[]> =>
    prisma.parkingRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: { requester: NAME },
    }),

  listAllWithRequesterContact: (): Promise<ParkingRequestWithRequesterContact[]> =>
    prisma.parkingRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: { requester: NAME_EMAIL },
    }),

  listAllForExport: (): Promise<ParkingRequestForExport[]> =>
    prisma.parkingRequest.findMany({ orderBy: { createdAt: "desc" }, include: EXPORT_INCLUDE }),

  listActiveBookingsFrom: (from): Promise<SpaceBookingSummary[]> =>
    prisma.parkingRequest.findMany({
      where: {
        parkingSpaceId: { not: null },
        slotStatus: "Assigned",
        status: { not: "Cancelled" },
        endDate: { gte: from },
      },
      select: {
        parkingSpaceId: true,
        companyName: true,
        serviceType: true,
        requiredStartDate: true,
        endDate: true,
      },
      orderBy: { requiredStartDate: "asc" },
    }),

  countByParkingSpace: (parkingSpaceId) => prisma.parkingRequest.count({ where: { parkingSpaceId } }),
  countByRateVersion: (rateVersionId) => prisma.parkingRequest.count({ where: { rateVersionId } }),

  findLockedSpaceIds: async (start, end, excludeRequestId) => {
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
  },

  findUpcomingBookingForSpace: (parkingSpaceId, from) =>
    prisma.parkingRequest.findFirst({
      where: {
        parkingSpaceId,
        slotStatus: "Assigned",
        status: { not: "Cancelled" },
        endDate: { gte: from },
      },
    }),

  deleteWithEvents: async (id) => {
    await prisma.$transaction([
      prisma.requestEvent.deleteMany({ where: { requestId: id } }),
      prisma.parkingRequest.delete({ where: { id } }),
    ]);
  },
};

const requestEvents: RequestEventRepository = {
  listForRequest: (requestId): Promise<RequestEventWithActor[]> =>
    prisma.requestEvent.findMany({
      where: { requestId },
      orderBy: { createdAt: "asc" },
      include: { actor: ACTOR },
    }),
};

// --- access requests ------------------------------------------------------

const accessRequests: AccessRequestRepository = {
  transition: (id, spec) => prisma.$transaction((tx) => runAccessChain(tx, id, spec)),

  create: (input: NewAccessRequestInput, opts: CreateWithEvent<AccessRequestRecord, AccessRequestPatch>) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.accessRequest.create({ data: input });
      await tx.accessRequestEvent.create({ data: eventData(created.id, opts.event) });

      const next = opts.andThen?.(created) ?? null;
      return next ? runAccessChain(tx, created.id, next) : created;
    }),

  findById: (id) => prisma.accessRequest.findUnique({ where: { id } }),

  findDetailById: (id): Promise<AccessRequestDetail | null> =>
    prisma.accessRequest.findUnique({ where: { id }, include: ACCESS_DETAIL_INCLUDE }),

  listAllWithRequesterName: (): Promise<AccessRequestWithRequesterName[]> =>
    prisma.accessRequest.findMany({ orderBy: { createdAt: "desc" }, include: { requester: NAME } }),

  listAllWithRequesterContact: (): Promise<AccessRequestWithRequesterContact[]> =>
    prisma.accessRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: { requester: NAME_EMAIL },
    }),
};

const accessRequestEvents: AccessRequestEventRepository = {
  listForRequest: (requestId): Promise<AccessRequestEventRecord[]> =>
    prisma.accessRequestEvent.findMany({ where: { requestId }, orderBy: { createdAt: "asc" } }),
};

// --- reference data -------------------------------------------------------

const rateTable: RateTableRepository = {
  listAll: (): Promise<RateTableEntryWithCreator[]> =>
    prisma.rateTableEntry.findMany({
      orderBy: [{ serviceType: "asc" }, { effectiveStartDate: "desc" }],
      include: { createdBy: NAME },
    }),

  findById: (id) => prisma.rateTableEntry.findUnique({ where: { id } }),

  create: (input: NewRateEntryInput): Promise<RateTableEntryRecord> =>
    prisma.rateTableEntry.create({ data: input }),

  delete: async (id) => {
    await prisma.rateTableEntry.delete({ where: { id } });
  },
};

const parkingSpaces: ParkingSpaceRepository = {
  listAll: (): Promise<ParkingSpaceWithCreator[]> =>
    prisma.parkingSpace.findMany({
      orderBy: [{ location: "asc" }, { slotNumber: "asc" }],
      include: { createdBy: NAME },
    }),

  listActive: (): Promise<ParkingSpaceRecord[]> =>
    prisma.parkingSpace.findMany({
      where: { isActive: true },
      orderBy: [{ location: "asc" }, { slotNumber: "asc" }],
    }),

  listDistinctActiveLocations: async () => {
    const spaces = await prisma.parkingSpace.findMany({
      where: { isActive: true },
      select: { location: true },
      distinct: ["location"],
      orderBy: { location: "asc" },
    });
    return spaces.map((s) => s.location);
  },

  findById: (id) => prisma.parkingSpace.findUnique({ where: { id } }),

  findActiveByLocationAndSlot: (location, slotNumber) =>
    prisma.parkingSpace.findFirst({ where: { location, slotNumber, isActive: true } }),

  findActiveSlotNumbers: async (location, slotNumbers) => {
    const existing = await prisma.parkingSpace.findMany({
      where: { location, slotNumber: { in: slotNumbers }, isActive: true },
      select: { slotNumber: true },
    });
    return new Set(existing.map((e) => e.slotNumber));
  },

  create: (input: NewParkingSpaceInput): Promise<ParkingSpaceRecord> =>
    prisma.parkingSpace.create({ data: input }),

  createMany: async (inputs) => {
    if (inputs.length === 0) return 0;
    const result = await prisma.parkingSpace.createMany({ data: inputs });
    return result.count;
  },

  update: (id, patch: ParkingSpacePatch): Promise<ParkingSpaceRecord> =>
    prisma.parkingSpace.update({ where: { id }, data: patch }),

  delete: async (id) => {
    await prisma.parkingSpace.delete({ where: { id } });
  },
};

export const prismaRepositories: Repositories = {
  users,
  parkingRequests,
  requestEvents,
  accessRequests,
  accessRequestEvents,
  rateTable,
  parkingSpaces,
};

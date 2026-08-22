import { addDays, addMonths, startOfDay } from "date-fns";
import { prisma } from "./db";
import type { SessionPayload } from "@/lib/auth";
import type { Role, ServiceType } from "@/lib/types";
import type { SubmitRequestInput } from "@/lib/workflows";
import type { SubmitAccessRequestInput } from "@/lib/access-workflows";

let seq = 0;
const uniqueEmail = (prefix: string) => `${prefix}-${++seq}-${Date.now()}@parking.test`;

export async function createUser(role: Role, overrides: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: {
      name: `${role} user`,
      email: uniqueEmail(role.toLowerCase()),
      // Not a real bcrypt hash — no test here logs in through verifyCredentials
      // except the ones that build their own hash explicitly.
      passwordHash: "test-placeholder-hash",
      role,
      emailVerifiedAt: new Date(),
      ...overrides,
    },
  });
}

export function sessionFor(user: { id: string; role: string; name: string; email: string }): SessionPayload {
  return { sub: user.id, role: user.role as Role, name: user.name, email: user.email };
}

/** A start date that satisfies BR-001/BR-002: a strictly later calendar day. */
export function futureStart(daysAhead = 2, hour = 9): Date {
  const d = addDays(startOfDay(new Date()), daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function intake(overrides: Partial<SubmitRequestInput> = {}): SubmitRequestInput {
  const serviceType: ServiceType = overrides.serviceType ?? "Daily";
  const requiredStartDate = overrides.requiredStartDate ?? futureStart();
  const endDate =
    overrides.endDate ??
    (serviceType === "Monthly" ? addMonths(requiredStartDate, 1) : addDays(requiredStartDate, 3));
  return {
    fullName: "Casey Requestor",
    companyName: "Acme Corp",
    emailAddress: "casey@acme.test",
    serviceType,
    preferredParkingLocation: "Tower A",
    purpose: "Staff parking",
    ...overrides,
    requiredStartDate,
    endDate,
  };
}

export function accessIntake(
  overrides: Partial<SubmitAccessRequestInput> = {},
): SubmitAccessRequestInput {
  return {
    enrollmentType: "Individual",
    requestType: "New Enrollment",
    fullName: "Casey Requestor",
    companyName: "Acme Corp",
    emailAddress: "casey@acme.test",
    vehiclePlateNumber: "ABC-1234",
    propertyLocation: "Tower A",
    contactNumber: "09170000000",
    requestedQuantity: 2,
    accessType: "RFID Sticker/Card/Metal Tag",
    ...overrides,
  };
}

export async function createRate(
  serviceType: ServiceType,
  rateAmount: number,
  effectiveStartDate = new Date("2024-01-01"),
  createdById?: string,
) {
  return prisma.rateTableEntry.create({
    data: { serviceType, chargingModel: serviceType, rateAmount, effectiveStartDate, createdById },
  });
}

export async function createSpace(location = "Tower A", slotNumber = "A-01", createdById?: string) {
  return prisma.parkingSpace.create({ data: { location, slotNumber, createdById } });
}

export async function eventsFor(requestId: string) {
  return prisma.requestEvent.findMany({ where: { requestId }, orderBy: { createdAt: "asc" } });
}

export async function accessEventsFor(requestId: string) {
  return prisma.accessRequestEvent.findMany({ where: { requestId }, orderBy: { createdAt: "asc" } });
}

/** Drives a request to Approved so payment/slot tests have a starting point. */
export async function approvedRequest(opts: { serviceType?: ServiceType; rate?: number } = {}) {
  const { submitRequest, wf02EndorseForValidation, wf03Decide } = await import("@/lib/workflows");
  const serviceType: ServiceType = opts.serviceType ?? "Daily";

  const requester = await createUser("REQUESTER");
  const prepared = await createUser("PREPARED_BY");
  const validated = await createUser("VALIDATED_BY");
  await createRate(serviceType, opts.rate ?? 100);

  const created = await submitRequest(intake({ serviceType }), requester.id);
  await wf02EndorseForValidation(created.id, sessionFor(prepared));
  const approved = await wf03Decide(created.id, sessionFor(validated), "Approved");

  return { request: approved, requester, prepared, validated };
}

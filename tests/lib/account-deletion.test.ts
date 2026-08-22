import { describe, it, expect } from "vitest";
import { getAccountHistoryBreakdown, describeAccountHistory } from "@/lib/accountDeletion";
import { submitRequest, wf02EndorseForValidation } from "@/lib/workflows";
import { submitAccessRequest } from "@/lib/access-workflows";
import { prisma } from "../helpers/db";
import { createUser, sessionFor, intake, accessIntake, createRate, createSpace } from "../helpers/factories";

describe("account history breakdown", () => {
  it("reports nothing for an account with no involvement", async () => {
    const user = await createUser("PREPARED_BY");
    const breakdown = await getAccountHistoryBreakdown(user.id);

    expect(describeAccountHistory(breakdown)).toBe("");
    expect(Object.values(breakdown).every((n) => n === 0)).toBe(true);
  });

  it("counts submitted requests", async () => {
    const requester = await createUser("REQUESTER");
    await submitRequest(intake(), requester.id);

    const breakdown = await getAccountHistoryBreakdown(requester.id);
    expect(breakdown.requestsSubmitted).toBe(1);
    expect(describeAccountHistory(breakdown)).toContain("1 request(s) submitted");
  });

  it("counts prepared requests and timeline events together", async () => {
    const requester = await createUser("REQUESTER");
    const prepared = await createUser("PREPARED_BY");
    const request = await submitRequest(intake(), requester.id);
    await wf02EndorseForValidation(request.id, sessionFor(prepared));

    const breakdown = await getAccountHistoryBreakdown(prepared.id);
    expect(breakdown.requestsPrepared).toBe(1);
    expect(breakdown.events).toBe(1);

    const description = describeAccountHistory(breakdown);
    expect(description).toContain("1 request(s) prepared");
    expect(description).toContain("1 request timeline event(s)");
  });

  it("counts access request involvement", async () => {
    const requester = await createUser("REQUESTER");
    await submitAccessRequest(accessIntake(), requester.id);

    const breakdown = await getAccountHistoryBreakdown(requester.id);
    expect(breakdown.accessRequestsSubmitted).toBe(1);
    expect(breakdown.accessEvents).toBe(1);
  });

  // Attribution-only relations must NOT block deletion — the delete route nulls
  // them out instead. If these ever start appearing in the breakdown, an
  // account that only ever added reference data becomes undeletable.
  it("excludes rate-table authorship from the blocking breakdown", async () => {
    const manager = await createUser("PARKING_MANAGEMENT");
    await createRate("Daily", 100, new Date("2024-01-01"), manager.id);

    const breakdown = await getAccountHistoryBreakdown(manager.id);
    expect(describeAccountHistory(breakdown)).toBe("");
    expect(breakdown).not.toHaveProperty("rateTableEntries");
  });

  it("excludes parking-space authorship from the blocking breakdown", async () => {
    const manager = await createUser("PARKING_MANAGEMENT");
    await createSpace("Tower A", "A-01", manager.id);

    const breakdown = await getAccountHistoryBreakdown(manager.id);
    expect(describeAccountHistory(breakdown)).toBe("");
    expect(breakdown).not.toHaveProperty("parkingSpaces");
  });

  it("joins multiple history types into one message", async () => {
    const requester = await createUser("REQUESTER");
    await submitRequest(intake(), requester.id);
    await submitAccessRequest(accessIntake(), requester.id);

    const description = describeAccountHistory(await getAccountHistoryBreakdown(requester.id));
    expect(description).toContain("request(s) submitted");
    expect(description).toContain("access request(s) submitted");
    expect(description).toContain(", ");
  });

  it("returns an empty object for an unknown account id", async () => {
    expect(await getAccountHistoryBreakdown("no-such-user")).toEqual({});
  });
});

describe("attribution nulling (as performed by the delete route)", () => {
  it("lets an account with only attribution be deleted once attribution is cleared", async () => {
    const manager = await createUser("PARKING_MANAGEMENT");
    const rate = await createRate("Daily", 100, new Date("2024-01-01"), manager.id);
    const space = await createSpace("Tower A", "A-01", manager.id);

    await prisma.$transaction([
      prisma.rateTableEntry.updateMany({ where: { createdById: manager.id }, data: { createdById: null } }),
      prisma.parkingSpace.updateMany({ where: { createdById: manager.id }, data: { createdById: null } }),
      prisma.user.delete({ where: { id: manager.id } }),
    ]);

    // The reference rows survive with their attribution nulled, not deleted.
    expect(await prisma.rateTableEntry.findUniqueOrThrow({ where: { id: rate.id } })).toMatchObject({
      createdById: null,
      rateAmount: 100,
    });
    expect(await prisma.parkingSpace.findUniqueOrThrow({ where: { id: space.id } })).toMatchObject({
      createdById: null,
      isActive: true,
    });
    expect(await prisma.user.count({ where: { id: manager.id } })).toBe(0);
  });

  it("refuses at the database level to delete an account still referenced by a request", async () => {
    const requester = await createUser("REQUESTER");
    await submitRequest(intake(), requester.id);

    await expect(prisma.user.delete({ where: { id: requester.id } })).rejects.toThrow();
  });
});

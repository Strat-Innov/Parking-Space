import { describe, it, expect } from "vitest";
import {
  submitAccessRequest,
  processAccessRequest,
  completeAccessRequest,
  cancelAccessRequest,
} from "@/lib/access-workflows";
import { prisma } from "../helpers/db";
import { createUser, sessionFor, accessIntake, accessEventsFor } from "../helpers/factories";

const processInput = {
  confirmedQuantity: 2,
  accessSeriesRef: "SER-100",
  purchasedCharge: 500,
  officialReceiptRef: "OR-900",
};

async function submitted() {
  const requester = await createUser("REQUESTER");
  const request = await submitAccessRequest(accessIntake(), requester.id);
  return { request, requester };
}

async function processed() {
  const { request } = await submitted();
  const manager = await createUser("PARKING_MANAGEMENT");
  const updated = await processAccessRequest(request.id, sessionFor(manager), processInput);
  return { request: updated, manager };
}

describe("AWF01 — access submission", () => {
  it("creates the request in Submitted (single-track lifecycle)", async () => {
    const { request, requester } = await submitted();

    expect(request.status).toBe("Submitted");
    expect(request.requesterId).toBe(requester.id);
    expect(request.processedById).toBeNull();
    expect(request.completedById).toBeNull();
  });

  it("logs exactly one AWF01 event", async () => {
    const { request, requester } = await submitted();
    const events = await accessEventsFor(request.id);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workflow: "AWF01",
      fromStatus: null,
      toStatus: "Submitted",
      actorId: requester.id,
      note: "Item created",
    });
  });

  it("normalises optional blank fields to null", async () => {
    const requester = await createUser("REQUESTER");
    const request = await submitAccessRequest(
      accessIntake({ remarks: "", approverName: "", transferTo: "", transferFrom: "" }),
      requester.id,
    );

    expect(request.remarks).toBeNull();
    expect(request.approverName).toBeNull();
    expect(request.transferTo).toBeNull();
    expect(request.transferFrom).toBeNull();
  });

  it("sets dateOfRequest server-side", async () => {
    const before = Date.now();
    const { request } = await submitted();
    expect(request.dateOfRequest.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe("AWF02 — process (combined validation and endorsement)", () => {
  it("records every issuance field in one step", async () => {
    const { request, manager } = await processed();

    expect(request.status).toBe("Processed");
    expect(request.processedById).toBe(manager.id);
    expect(request.processedDate).not.toBeNull();
    expect(request.confirmedQuantity).toBe(2);
    expect(request.accessSeriesRef).toBe("SER-100");
    expect(request.purchasedCharge).toBe(500);
    expect(request.officialReceiptRef).toBe("OR-900");
  });

  it.each(["PREPARED_BY", "VALIDATED_BY", "DEVELOPER"] as const)(
    "refuses %s with 403",
    async (role) => {
      const { request } = await submitted();
      const actor = await createUser(role);
      await expect(
        processAccessRequest(request.id, sessionFor(actor), processInput),
      ).rejects.toMatchObject({ status: 403 });
    },
  );

  it("requires an access series reference (422)", async () => {
    const { request } = await submitted();
    const manager = await createUser("PARKING_MANAGEMENT");
    await expect(
      processAccessRequest(request.id, sessionFor(manager), { ...processInput, accessSeriesRef: " " }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("requires an official receipt number (422)", async () => {
    const { request } = await submitted();
    const manager = await createUser("PARKING_MANAGEMENT");
    await expect(
      processAccessRequest(request.id, sessionFor(manager), { ...processInput, officialReceiptRef: "" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses unless status is Submitted (409)", async () => {
    const { request, manager } = await processed();
    await expect(
      processAccessRequest(request.id, sessionFor(manager), processInput),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("logs an AWF02 event carrying the series reference", async () => {
    const { request } = await processed();
    const events = await accessEventsFor(request.id);

    expect(events.at(-1)).toMatchObject({
      workflow: "AWF02",
      fromStatus: "Submitted",
      toStatus: "Processed",
      note: "Access series SER-100",
    });
  });
});

describe("AWF03 — completion", () => {
  it("records who received the access", async () => {
    const { request, manager } = await processed();
    const completed = await completeAccessRequest(request.id, sessionFor(manager), "Jane Client");

    expect(completed.status).toBe("Completed");
    expect(completed.receivedByName).toBe("Jane Client");
    expect(completed.completedById).toBe(manager.id);
    expect(completed.completedDate).not.toBeNull();
  });

  it("requires a Received By name (422)", async () => {
    const { request, manager } = await processed();
    await expect(
      completeAccessRequest(request.id, sessionFor(manager), "  "),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses unless status is Processed (409)", async () => {
    const { request } = await submitted();
    const manager = await createUser("PARKING_MANAGEMENT");
    await expect(
      completeAccessRequest(request.id, sessionFor(manager), "Jane"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a non-Parking Management actor with 403", async () => {
    const { request } = await processed();
    const prepared = await createUser("PREPARED_BY");
    await expect(
      completeAccessRequest(request.id, sessionFor(prepared), "Jane"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("logs an AWF03 event naming the recipient", async () => {
    const { request, manager } = await processed();
    await completeAccessRequest(request.id, sessionFor(manager), "Jane Client");

    const events = await accessEventsFor(request.id);
    expect(events.at(-1)).toMatchObject({
      workflow: "AWF03",
      fromStatus: "Processed",
      toStatus: "Completed",
      note: "Received by Jane Client",
    });
  });
});

describe("access cancellation", () => {
  it("cancels from Submitted", async () => {
    const { request } = await submitted();
    const manager = await createUser("PARKING_MANAGEMENT");
    const cancelled = await cancelAccessRequest(request.id, sessionFor(manager));

    expect(cancelled.status).toBe("Cancelled");
    expect(cancelled.cancelledById).toBe(manager.id);
    expect(cancelled.cancelledDate).not.toBeNull();
  });

  it("cancels from Processed", async () => {
    const { request, manager } = await processed();
    const cancelled = await cancelAccessRequest(request.id, sessionFor(manager));
    expect(cancelled.status).toBe("Cancelled");
  });

  // Unlike Parking Space cancellation, this one is open to any staff role.
  it.each(["PREPARED_BY", "VALIDATED_BY", "PARKING_MANAGEMENT", "DEVELOPER"] as const)(
    "allows %s to cancel",
    async (role) => {
      const { request } = await submitted();
      const actor = await createUser(role);
      const cancelled = await cancelAccessRequest(request.id, sessionFor(actor));
      expect(cancelled.status).toBe("Cancelled");
    },
  );

  it("refuses to cancel a Completed request (409)", async () => {
    const { request, manager } = await processed();
    await completeAccessRequest(request.id, sessionFor(manager), "Jane");

    await expect(cancelAccessRequest(request.id, sessionFor(manager))).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses to cancel twice (409)", async () => {
    const { request } = await submitted();
    const manager = await createUser("PARKING_MANAGEMENT");
    await cancelAccessRequest(request.id, sessionFor(manager));

    await expect(cancelAccessRequest(request.id, sessionFor(manager))).rejects.toMatchObject({
      status: 409,
    });
  });

  it("logs a CANCEL event recording the prior status", async () => {
    const { request, manager } = await processed();
    await cancelAccessRequest(request.id, sessionFor(manager));

    const events = await accessEventsFor(request.id);
    expect(events.at(-1)).toMatchObject({
      workflow: "CANCEL",
      fromStatus: "Processed",
      toStatus: "Cancelled",
      actorId: manager.id,
    });
  });

  it("keeps the row rather than deleting it", async () => {
    const { request } = await submitted();
    const manager = await createUser("PARKING_MANAGEMENT");
    await cancelAccessRequest(request.id, sessionFor(manager));
    expect(await prisma.accessRequest.count({ where: { id: request.id } })).toBe(1);
  });
});

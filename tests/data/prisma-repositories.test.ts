import { describe, it, expect } from "vitest";
import { repos } from "@/lib/data";
import type { ParkingRequestTransition } from "@/lib/data";
import { submitRequest, WorkflowError } from "@/lib/workflows";
import { prisma } from "../helpers/db";
import { createUser, createRate, createSpace, intake, futureStart, eventsFor } from "../helpers/factories";

// Phase 1 moved the transaction boundary out of the workflow functions and
// into the repository. These tests exist to prove it is still a boundary:
// they assert at the database level that a failed transition leaves NOTHING
// behind — no field change, no orphaned audit row. The 207 behavioural tests
// cannot see this, because from the caller's side a rollback and a rejected
// precondition look identical.

async function aRequest() {
  const requester = await createUser("REQUESTER");
  return submitRequest(intake(), requester.id);
}

describe("transition — atomicity of update + event", () => {
  it("applies the patch and appends exactly one event", async () => {
    const request = await aRequest();

    const updated = await repos.parkingRequests.transition(request.id, {
      plan: () => ({
        patch: { companyName: "Renamed Corp" },
        event: {
          workflow: "TEST",
          fromStatus: null,
          toStatus: null,
          actorId: null,
          note: "renamed",
        },
      }),
    });

    expect(updated.companyName).toBe("Renamed Corp");
    const events = await eventsFor(request.id);
    expect(events.filter((e) => e.workflow === "TEST")).toHaveLength(1);
  });

  it("writes neither the update nor an event when plan throws", async () => {
    const request = await aRequest();
    const before = await eventsFor(request.id);

    await expect(
      repos.parkingRequests.transition(request.id, {
        plan: () => {
          throw new WorkflowError("nope", 409);
        },
      }),
    ).rejects.toThrow("nope");

    const after = await prisma.parkingRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.companyName).toBe(request.companyName);
    expect(await eventsFor(request.id)).toHaveLength(before.length);
  });

  it("rolls back a committed update when the event append fails", async () => {
    const request = await aRequest();

    // An event referencing a non-existent actor violates the FK, so the append
    // fails after the update has already been issued. Both must disappear.
    await expect(
      repos.parkingRequests.transition(request.id, {
        plan: () => ({
          patch: { companyName: "Should Not Persist" },
          event: {
            workflow: "TEST",
            fromStatus: null,
            toStatus: null,
            actorId: "no-such-user-id",
            note: null,
          },
        }),
      }),
    ).rejects.toThrow();

    const after = await prisma.parkingRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.companyName).toBe(request.companyName);
    expect(after.companyName).not.toBe("Should Not Persist");
  });
});

describe("transition — andThen chains are one unit of work", () => {
  it("applies both steps and both events", async () => {
    const request = await aRequest();

    const final = await repos.parkingRequests.transition(request.id, {
      plan: () => ({
        patch: { companyName: "First" },
        event: { workflow: "STEP1", fromStatus: null, toStatus: null, actorId: null, note: null },
      }),
      andThen: () => ({
        plan: () => ({
          patch: { purpose: "Second" },
          event: { workflow: "STEP2", fromStatus: null, toStatus: null, actorId: null, note: null },
        }),
      }),
    });

    expect(final.companyName).toBe("First");
    expect(final.purpose).toBe("Second");
    const workflows = (await eventsFor(request.id)).map((e) => e.workflow);
    expect(workflows).toContain("STEP1");
    expect(workflows).toContain("STEP2");
  });

  it("sees the updated record when deciding the follow-on step", async () => {
    const request = await aRequest();
    let observed: string | null = null;

    await repos.parkingRequests.transition(request.id, {
      plan: () => ({
        patch: { companyName: "Updated Name" },
        event: { workflow: "STEP1", fromStatus: null, toStatus: null, actorId: null, note: null },
      }),
      andThen: (updated) => {
        observed = updated.companyName;
        return null;
      },
    });

    expect(observed).toBe("Updated Name");
  });

  // This is the behaviour WF04 -> WF06 and WF05 -> WF06 depend on. Before
  // Phase 1 they shared one $transaction inside the workflow function; the
  // repository must not have weakened that into two independent writes.
  it("rolls the FIRST step back when the follow-on step fails", async () => {
    const request = await aRequest();
    const before = await eventsFor(request.id);

    await expect(
      repos.parkingRequests.transition(request.id, {
        plan: () => ({
          patch: { companyName: "First step" },
          event: { workflow: "STEP1", fromStatus: null, toStatus: null, actorId: null, note: null },
        }),
        andThen: (): ParkingRequestTransition => ({
          plan: () => {
            throw new WorkflowError("second step failed", 409);
          },
        }),
      }),
    ).rejects.toThrow("second step failed");

    const after = await prisma.parkingRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.companyName).toBe(request.companyName);
    expect(await eventsFor(request.id)).toHaveLength(before.length);
  });
});

describe("create — creation and its follow-on are one unit of work", () => {
  it("leaves no request and no events when the follow-on fails", async () => {
    const requester = await createUser("REQUESTER");

    await expect(
      repos.parkingRequests.create(
        {
          fullName: "Casey",
          companyName: "Acme",
          emailAddress: "casey@acme.test",
          serviceType: "Daily",
          preferredParkingLocation: "Tower A",
          requestedSlot: null,
          dateOfRequest: new Date(),
          requiredStartDate: futureStart(2),
          endDate: futureStart(5),
          purpose: "Testing rollback",
          status: "Submitted",
          approvalStage: "Prepared By",
          requesterId: requester.id,
          totalHours: null,
          totalDays: 3,
          totalMonths: null,
        },
        {
          event: {
            workflow: "WF01",
            fromStatus: "Submitted",
            toStatus: "Submitted",
            actorId: requester.id,
            note: "Item created",
          },
          andThen: () => ({
            plan: () => {
              throw new WorkflowError("routing failed", 500);
            },
          }),
        },
      ),
    ).rejects.toThrow("routing failed");

    expect(await prisma.parkingRequest.count()).toBe(0);
    expect(await prisma.requestEvent.count()).toBe(0);
  });
});

describe("atomic numeric delta", () => {
  it("increments rather than overwriting", async () => {
    const request = await aRequest();

    for (let i = 0; i < 3; i++) {
      await repos.parkingRequests.transition(request.id, {
        plan: () => ({
          patch: { rejectionCount: { increment: 1 } },
          event: { workflow: "TEST", fromStatus: null, toStatus: null, actorId: null, note: null },
        }),
      });
    }

    const after = await prisma.parkingRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.rejectionCount).toBe(3);
  });
});

describe("TransitionReads", () => {
  it("resolves the latest rate effective on or before the given moment", async () => {
    const request = await aRequest();
    await createRate("Daily", 100, new Date("2020-01-01"));
    const newer = await createRate("Daily", 300, new Date("2024-01-01"));
    await createRate("Daily", 999, futureStart(30));

    let resolvedId: string | null = null;
    await repos.parkingRequests.transition(request.id, {
      plan: async (_req, reads) => {
        const rate = await reads.resolveCurrentRate("Daily", new Date());
        resolvedId = rate?.id ?? null;
        return {
          patch: {},
          event: { workflow: "TEST", fromStatus: null, toStatus: null, actorId: null, note: null },
        };
      },
    });

    expect(resolvedId).toBe(newer.id);
  });

  it("finds a conflicting booking and respects excludeRequestId", async () => {
    const request = await aRequest();
    const space = await createSpace();
    await prisma.parkingRequest.update({
      where: { id: request.id },
      data: { parkingSpaceId: space.id, slotStatus: "Assigned" },
    });

    let conflict: string | null | undefined;
    let selfExcluded: string | null | undefined;

    await repos.parkingRequests.transition(request.id, {
      plan: async (req, reads) => {
        conflict =
          (await reads.findConflictingBooking({
            parkingSpaceId: space.id,
            start: req.requiredStartDate,
            end: req.endDate,
          }))?.id ?? null;
        selfExcluded =
          (await reads.findConflictingBooking({
            parkingSpaceId: space.id,
            start: req.requiredStartDate,
            end: req.endDate,
            excludeRequestId: req.id,
          }))?.id ?? null;
        return {
          patch: {},
          event: { workflow: "TEST", fromStatus: null, toStatus: null, actorId: null, note: null },
        };
      },
    });

    expect(conflict).toBe(request.id);
    expect(selfExcluded).toBeNull();
  });
});

describe("multi-table deletes", () => {
  it("deleteWithEvents removes the request and its events together", async () => {
    const request = await aRequest();
    expect((await eventsFor(request.id)).length).toBeGreaterThan(0);

    await repos.parkingRequests.deleteWithEvents(request.id);

    expect(await prisma.parkingRequest.count({ where: { id: request.id } })).toBe(0);
    expect(await prisma.requestEvent.count({ where: { requestId: request.id } })).toBe(0);
  });

  it("deleteWithAttributionCleared nulls authorship and removes the account", async () => {
    const manager = await createUser("PARKING_MANAGEMENT");
    const rate = await createRate("Daily", 100, new Date("2024-01-01"), manager.id);
    const space = await createSpace("Tower A", "A-01", manager.id);

    await repos.users.deleteWithAttributionCleared(manager.id);

    expect(await prisma.user.count({ where: { id: manager.id } })).toBe(0);
    expect((await prisma.rateTableEntry.findUniqueOrThrow({ where: { id: rate.id } })).createdById).toBeNull();
    expect((await prisma.parkingSpace.findUniqueOrThrow({ where: { id: space.id } })).createdById).toBeNull();
  });

  it("leaves the account intact when the delete cannot complete", async () => {
    const requester = await createUser("REQUESTER");
    await submitRequest(intake(), requester.id);

    await expect(repos.users.deleteWithAttributionCleared(requester.id)).rejects.toThrow();
    expect(await prisma.user.count({ where: { id: requester.id } })).toBe(1);
  });
});

describe("resolveRequesterForSubmission", () => {
  it("reuses an existing staff account rather than creating a guest row", async () => {
    const staff = await createUser("PREPARED_BY", { email: "staff@acme.test" });
    const id = await repos.users.resolveRequesterForSubmission("Someone Else", "STAFF@acme.test");

    expect(id).toBe(staff.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it("creates a REQUESTER row when no account matches", async () => {
    const id = await repos.users.resolveRequesterForSubmission("New Person", "new@acme.test");
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });

    expect(user.role).toBe("REQUESTER");
    expect(user.email).toBe("new@acme.test");
  });
});

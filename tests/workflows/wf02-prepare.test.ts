import { describe, it, expect } from "vitest";
import { addDays, startOfDay } from "date-fns";
import { submitRequest, updateRequestDetails, wf02EndorseForValidation } from "@/lib/workflows";
import { prisma } from "../helpers/db";
import { createUser, sessionFor, intake, futureStart, eventsFor } from "../helpers/factories";

async function submitted() {
  const requester = await createUser("REQUESTER");
  const request = await submitRequest(intake(), requester.id);
  return request;
}

describe("WF02 — Prepared By edit", () => {
  it("lets Prepared By correct intake fields while In Preparation", async () => {
    const request = await submitted();
    const prepared = await createUser("PREPARED_BY");

    const updated = await updateRequestDetails(
      request.id,
      sessionFor(prepared),
      intake({ companyName: "Corrected Corp", purpose: "Corrected purpose" }),
    );

    expect(updated.companyName).toBe("Corrected Corp");
    expect(updated.purpose).toBe("Corrected purpose");
    expect(updated.status).toBe("In Preparation");
  });

  it("logs a WF02 edit event", async () => {
    const request = await submitted();
    const prepared = await createUser("PREPARED_BY");
    await updateRequestDetails(request.id, sessionFor(prepared), intake({ companyName: "X" }));

    const events = await eventsFor(request.id);
    const edit = events.at(-1);
    expect(edit).toMatchObject({
      workflow: "WF02",
      actorId: prepared.id,
      note: "Details edited by Prepared By",
    });
  });

  it("recomputes totals when the service type or span changes", async () => {
    const request = await submitted();
    const prepared = await createUser("PREPARED_BY");
    const start = futureStart();

    const updated = await updateRequestDetails(
      request.id,
      sessionFor(prepared),
      intake({ serviceType: "Hourly", requiredStartDate: start, endDate: addDays(start, 1) }),
    );

    expect(updated.totalHours).toBe(24);
    expect(updated.totalDays).toBeNull();
    expect(updated.totalMonths).toBeNull();
  });

  it.each(["VALIDATED_BY", "PARKING_MANAGEMENT", "DEVELOPER"] as const)(
    "refuses %s with 403",
    async (role) => {
      const request = await submitted();
      const actor = await createUser(role);
      await expect(
        updateRequestDetails(request.id, sessionFor(actor), intake()),
      ).rejects.toMatchObject({ status: 403, message: "Only Prepared By can edit request details." });
    },
  );

  it("refuses once the request has left In Preparation", async () => {
    const request = await submitted();
    const prepared = await createUser("PREPARED_BY");
    await wf02EndorseForValidation(request.id, sessionFor(prepared));

    await expect(
      updateRequestDetails(request.id, sessionFor(prepared), intake()),
    ).rejects.toMatchObject({ status: 409 });
  });

  // BR-003 fixes Date of Request at submission; an edit anchors its date rules
  // to that ORIGINAL date, not to "now". A start date in the past relative to
  // today, but future relative to the original request date, must be accepted.
  it("anchors edit validation to the original dateOfRequest, not now", async () => {
    const request = await submitted();
    const prepared = await createUser("PREPARED_BY");

    const tenDaysAgo = addDays(startOfDay(new Date()), -10);
    await prisma.parkingRequest.update({
      where: { id: request.id },
      data: { dateOfRequest: tenDaysAgo },
    });

    const startInPastButAfterRequestDate = addDays(startOfDay(new Date()), -5);
    const updated = await updateRequestDetails(
      request.id,
      sessionFor(prepared),
      intake({
        requiredStartDate: startInPastButAfterRequestDate,
        endDate: addDays(startInPastButAfterRequestDate, 2),
      }),
    );

    expect(updated.requiredStartDate.getTime()).toBe(startInPastButAfterRequestDate.getTime());
  });

  it("still refuses an edit that violates the rules against the original date", async () => {
    const request = await submitted();
    const prepared = await createUser("PREPARED_BY");

    const tenDaysAgo = addDays(startOfDay(new Date()), -10);
    await prisma.parkingRequest.update({
      where: { id: request.id },
      data: { dateOfRequest: tenDaysAgo },
    });

    const beforeRequestDate = addDays(startOfDay(new Date()), -20);
    await expect(
      updateRequestDetails(
        request.id,
        sessionFor(prepared),
        intake({ requiredStartDate: beforeRequestDate, endDate: addDays(beforeRequestDate, 2) }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("WF02 — endorse for validation", () => {
  it("moves In Preparation to Pending Approval and records preparedById", async () => {
    const request = await submitted();
    const prepared = await createUser("PREPARED_BY");

    const updated = await wf02EndorseForValidation(request.id, sessionFor(prepared));

    expect(updated.status).toBe("Pending Approval");
    expect(updated.approvalStage).toBe("Validated By");
    expect(updated.preparedById).toBe(prepared.id);
  });

  it("logs the transition", async () => {
    const request = await submitted();
    const prepared = await createUser("PREPARED_BY");
    await wf02EndorseForValidation(request.id, sessionFor(prepared));

    const events = await eventsFor(request.id);
    expect(events.at(-1)).toMatchObject({
      workflow: "WF02",
      fromStatus: "In Preparation",
      toStatus: "Pending Approval",
      actorId: prepared.id,
      note: "Endorsed for validation",
    });
  });

  it("refuses a non-Prepared By actor with 403", async () => {
    const request = await submitted();
    const validated = await createUser("VALIDATED_BY");
    await expect(
      wf02EndorseForValidation(request.id, sessionFor(validated)),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a second endorsement with 409", async () => {
    const request = await submitted();
    const prepared = await createUser("PREPARED_BY");
    await wf02EndorseForValidation(request.id, sessionFor(prepared));

    await expect(
      wf02EndorseForValidation(request.id, sessionFor(prepared)),
    ).rejects.toMatchObject({ status: 409 });
  });
});

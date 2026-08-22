import { describe, it, expect } from "vitest";
import { isActionable } from "@/lib/dashboard";
import type { Role } from "@/lib/types";

const row = (status: string, paymentStatus = "Not Started", slotStatus = "Unassigned") =>
  ({ status, paymentStatus, slotStatus }) as Parameters<typeof isActionable>[1];

// Shared by the dashboard and the export route, so "Other Requests" means the
// same set in both. Any divergence here changes what a bulk export contains.
describe("isActionable — PREPARED_BY", () => {
  it("owns anything In Preparation (WF02)", () => {
    expect(isActionable("PREPARED_BY", row("In Preparation"))).toBe(true);
  });

  it("owns an Approved request whose payment is not yet confirmed (WF04)", () => {
    expect(isActionable("PREPARED_BY", row("Approved", "Not Started"))).toBe(true);
    expect(isActionable("PREPARED_BY", row("Approved", "Pending"))).toBe(true);
  });

  it("drops an Approved request once payment is confirmed", () => {
    expect(isActionable("PREPARED_BY", row("Approved", "Confirmed"))).toBe(false);
  });

  it("ignores Pending Approval, Completed and Cancelled", () => {
    expect(isActionable("PREPARED_BY", row("Pending Approval"))).toBe(false);
    expect(isActionable("PREPARED_BY", row("Completed"))).toBe(false);
    expect(isActionable("PREPARED_BY", row("Cancelled"))).toBe(false);
  });
});

describe("isActionable — VALIDATED_BY", () => {
  it("owns exactly Pending Approval", () => {
    expect(isActionable("VALIDATED_BY", row("Pending Approval"))).toBe(true);
  });

  it("ignores everything else", () => {
    for (const s of ["In Preparation", "Approved", "Completed", "Cancelled", "Submitted"]) {
      expect(isActionable("VALIDATED_BY", row(s))).toBe(false);
    }
  });
});

describe("isActionable — PARKING_MANAGEMENT", () => {
  it("owns an Approved request with no slot yet (WF05)", () => {
    expect(isActionable("PARKING_MANAGEMENT", row("Approved", "Not Started", "Unassigned"))).toBe(true);
  });

  it("drops it once the slot is assigned", () => {
    expect(isActionable("PARKING_MANAGEMENT", row("Approved", "Not Started", "Assigned"))).toBe(false);
  });

  it("ignores non-Approved statuses", () => {
    expect(isActionable("PARKING_MANAGEMENT", row("In Preparation"))).toBe(false);
    expect(isActionable("PARKING_MANAGEMENT", row("Completed", "Confirmed", "Assigned"))).toBe(false);
  });
});

describe("isActionable — roles with no queue", () => {
  it.each(["REQUESTER", "DEVELOPER"] as Role[])("returns false for %s in every state", (role) => {
    for (const s of ["In Preparation", "Pending Approval", "Approved", "Completed", "Cancelled"]) {
      expect(isActionable(role, row(s))).toBe(false);
    }
  });
});

// BR-006: the two tracks are independent, so the same Approved request can be
// actionable for two different roles at once.
describe("isActionable — BR-006 independence", () => {
  it("shows one Approved request to both Prepared By and Parking Management", () => {
    const r = row("Approved", "Not Started", "Unassigned");
    expect(isActionable("PREPARED_BY", r)).toBe(true);
    expect(isActionable("PARKING_MANAGEMENT", r)).toBe(true);
  });

  it("drops it per-role as each track completes", () => {
    const paid = row("Approved", "Confirmed", "Unassigned");
    expect(isActionable("PREPARED_BY", paid)).toBe(false);
    expect(isActionable("PARKING_MANAGEMENT", paid)).toBe(true);
  });
});

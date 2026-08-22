import { describe, it, expect } from "vitest";
import { computeTotals } from "@/lib/workflows";

const d = (s: string) => new Date(s);

describe("computeTotals — Hourly", () => {
  it("counts whole hours", () => {
    const t = computeTotals("Hourly", d("2026-03-01T08:00:00Z"), d("2026-03-01T13:00:00Z"));
    expect(t).toEqual({ totalHours: 5, totalDays: null, totalMonths: null });
  });

  it("rounds a partial hour up", () => {
    const t = computeTotals("Hourly", d("2026-03-01T08:00:00Z"), d("2026-03-01T09:30:00Z"));
    expect(t.totalHours).toBe(2);
  });

  it("never returns less than one hour", () => {
    const t = computeTotals("Hourly", d("2026-03-01T08:00:00Z"), d("2026-03-01T08:01:00Z"));
    expect(t.totalHours).toBe(1);
  });
});

describe("computeTotals — Daily", () => {
  it("counts whole days", () => {
    const t = computeTotals("Daily", d("2026-03-01T00:00:00Z"), d("2026-03-04T00:00:00Z"));
    expect(t).toEqual({ totalHours: null, totalDays: 3, totalMonths: null });
  });

  it("rounds a partial day up", () => {
    const t = computeTotals("Daily", d("2026-03-01T00:00:00Z"), d("2026-03-02T06:00:00Z"));
    expect(t.totalDays).toBe(2);
  });

  it("never returns less than one day", () => {
    const t = computeTotals("Daily", d("2026-03-01T08:00:00Z"), d("2026-03-01T09:00:00Z"));
    expect(t.totalDays).toBe(1);
  });
});

// The calendar-month rule the implementation comment calls out: a fixed 30-day
// divisor would bill two months for a single real month in any 31-day month.
describe("computeTotals — Monthly is calendar-aware, not 30-day arithmetic", () => {
  it("treats Aug 10 to Sep 10 as exactly one month (31 real days)", () => {
    const t = computeTotals("Monthly", d("2026-08-10T00:00:00Z"), d("2026-09-10T00:00:00Z"));
    expect(t.totalMonths).toBe(1);
  });

  it("treats Jan 31 to Feb 28 as one month", () => {
    const t = computeTotals("Monthly", d("2026-01-31T00:00:00Z"), d("2026-02-28T00:00:00Z"));
    expect(t.totalMonths).toBe(1);
  });

  it("counts a full three-month span as three", () => {
    const t = computeTotals("Monthly", d("2026-01-15T00:00:00Z"), d("2026-04-15T00:00:00Z"));
    expect(t.totalMonths).toBe(3);
  });

  it("rounds a part-month remainder up", () => {
    const t = computeTotals("Monthly", d("2026-01-15T00:00:00Z"), d("2026-03-20T00:00:00Z"));
    expect(t.totalMonths).toBe(3);
  });

  it("never returns less than one month", () => {
    const t = computeTotals("Monthly", d("2026-01-15T00:00:00Z"), d("2026-01-16T00:00:00Z"));
    expect(t.totalMonths).toBe(1);
  });

  it("sets only the monthly total", () => {
    const t = computeTotals("Monthly", d("2026-01-15T00:00:00Z"), d("2026-02-15T00:00:00Z"));
    expect(t.totalHours).toBeNull();
    expect(t.totalDays).toBeNull();
  });
});

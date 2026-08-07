"use client";

import { useState } from "react";
import { SERVICE_TYPES } from "@/lib/types";

export default function NewRequestForm() {
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: "",
    companyName: "",
    emailAddress: "",
    serviceType: "Daily",
    preferredParkingLocation: "",
    startDate: "", // YYYY-MM-DD
    endDate: "", // YYYY-MM-DD
    startTime: "", // HH:mm — Hourly's Start Time, or the single shared Daily/Monthly check-in time
    endTime: "", // HH:mm — Hourly only, independent End Time
    purpose: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isHourly = form.serviceType === "Hourly";

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toDateStr(d: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function addDaysStr(dateStr: string, days: number) {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + days);
    return toDateStr(d);
  }
  function addMonthsStr(dateStr: string, months: number) {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setMonth(d.getMonth() + months);
    return toDateStr(d);
  }

  // Minimum valid End Date depends on Service Type: Hourly can be same-day
  // (duration comes from Start/End Time instead); Daily needs at least the
  // next calendar day (Start Date's check-in time now carries onto End Date
  // too, so same-day would be zero duration); Monthly needs a full calendar
  // month, not just "later" (this was the reported bug — a few days into
  // the same month was being accepted as a "monthly" booking).
  function minEndDateFor(startDate: string, serviceType: string) {
    if (!startDate) return startDate;
    if (serviceType === "Monthly") return addMonthsStr(startDate, 1);
    if (serviceType === "Daily") return addDaysStr(startDate, 1);
    return startDate; // Hourly
  }

  function updateStartDate(value: string) {
    setForm((f) => {
      const min = minEndDateFor(value, f.serviceType);
      const endStillValid = f.endDate && value && f.endDate >= min;
      return { ...f, startDate: value, endDate: endStillValid ? f.endDate : "" };
    });
  }

  function updateServiceType(value: string) {
    setForm((f) => {
      // Different types have different valid End Date floors (see
      // minEndDateFor) and different time-field shapes (Hourly: two
      // independent pickers; Daily/Monthly: one shared picker) — clear
      // anything that might now be stale rather than silently carry over a
      // combination the server would reject anyway.
      const min = minEndDateFor(f.startDate, value);
      const endStillValid = f.endDate && f.startDate && f.endDate >= min;
      return { ...f, serviceType: value, endDate: endStillValid ? f.endDate : "", endTime: "" };
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Hourly: independent Start/End times. Daily/Monthly: the single
      // "Time" field is mirrored onto both ends (a real check-in time, not
      // implicit midnight) so day/month boundaries — and later, overnight
      // billing — can be computed from it rather than assumed.
      const requiredStartDate = `${form.startDate}T${form.startTime}`;
      const endDate = isHourly ? `${form.endDate}T${form.endTime}` : `${form.endDate}T${form.startTime}`;

      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName,
          companyName: form.companyName,
          emailAddress: form.emailAddress,
          serviceType: form.serviceType,
          preferredParkingLocation: form.preferredParkingLocation,
          requiredStartDate,
          endDate,
          purpose: form.purpose,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Submission failed");
      setSubmittedId(data.request.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minStartDate = toDateStr(tomorrow);
  const minEndDate = minEndDateFor(form.startDate, form.serviceType) || minStartDate;

  // For Hourly, End Time only needs a floor when End Date == Start Date
  // (same-day booking) — a later End Date has no relationship to Start Time.
  const sameDayHourly = isHourly && form.startDate && form.endDate && form.startDate === form.endDate;
  const minEndTime = sameDayHourly && form.startTime ? form.startTime : undefined;

  if (submittedId) {
    return (
      <div className="card space-y-3 text-center">
        <h2 className="text-lg font-semibold tracking-tight">Request submitted</h2>
        <p className="text-sm text-slate-600">
          Thanks, {form.fullName} — your parking request for <strong>{form.companyName}</strong> has been received and is now in review.
        </p>
        <p className="text-xs text-slate-400">
          Reference: <span className="font-mono">{submittedId}</span>
        </p>
        <p className="text-xs text-slate-500">Keep this reference for your records. You&apos;ll be contacted at {form.emailAddress}.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Full Name</label>
          <input required value={form.fullName} onChange={(e) => update("fullName", e.target.value)} placeholder="Your name" />
        </div>
        <div className="field">
          <label>Company Name</label>
          <input required value={form.companyName} onChange={(e) => update("companyName", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Email Address</label>
          <input type="email" required value={form.emailAddress} onChange={(e) => update("emailAddress", e.target.value)} />
        </div>
        <div className="field">
          <label>Service Type</label>
          <select value={form.serviceType} onChange={(e) => updateServiceType(e.target.value)}>
            {SERVICE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Preferred Parking Location</label>
        <input required value={form.preferredParkingLocation} onChange={(e) => update("preferredParkingLocation", e.target.value)} />
      </div>

      <div className="field">
        <label>Parking Date</label>
        <div className="flex items-center gap-2">
          <input
            type="date"
            required
            min={minStartDate}
            value={form.startDate}
            onChange={(e) => updateStartDate(e.target.value)}
            className="flex-1"
          />
          <span className="text-slate-400">—</span>
          <input
            type="date"
            required
            min={minEndDate}
            disabled={!form.startDate}
            value={form.endDate}
            onChange={(e) => update("endDate", e.target.value)}
            className="flex-1"
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {form.serviceType === "Monthly"
            ? "Start must be a later calendar day than today, and End at least 1 month after Start (BR-001/BR-002)."
            : "Start must be a later calendar day than today (BR-001/BR-002 — no backdating, no same-day requests)."}
        </p>
      </div>

      {isHourly ? (
        <div className="field">
          <label>Parking Time</label>
          <div className="flex items-center gap-2">
            <input
              type="time"
              required
              disabled={!form.startDate}
              value={form.startTime}
              onChange={(e) => update("startTime", e.target.value)}
              className="flex-1"
            />
            <span className="text-slate-400">—</span>
            <input
              type="time"
              required
              min={minEndTime}
              disabled={!form.startTime}
              value={form.endTime}
              onChange={(e) => update("endTime", e.target.value)}
              className="flex-1"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">End Time must be after Start Time on the same day.</p>
        </div>
      ) : (
        <div className="field">
          <label>Time</label>
          <input
            type="time"
            required
            disabled={!form.startDate}
            value={form.startTime}
            onChange={(e) => update("startTime", e.target.value)}
            className="w-40"
          />
          <p className="mt-1 text-xs text-slate-500">
            Your check-in time — applied to both the start and end date, so the parking period is a real 24-hour cycle from this
            time rather than midnight.
          </p>
        </div>
      )}

      <div className="field">
        <label>Purpose</label>
        <textarea required rows={3} value={form.purpose} onChange={(e) => update("purpose", e.target.value)} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Submitting..." : "Submit Request"}
      </button>
    </form>
  );
}

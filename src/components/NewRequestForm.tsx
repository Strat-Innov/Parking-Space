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
    startTime: "", // HH:mm — only meaningful/shown for Hourly
    endTime: "", // HH:mm — only meaningful/shown for Hourly
    purpose: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isHourly = form.serviceType === "Hourly";

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateStartDate(value: string) {
    setForm((f) => {
      // Clear a now-invalid End Date rather than silently submitting a
      // start/end pair the server will reject anyway.
      const endStillValid = f.endDate && value && f.endDate >= value;
      return { ...f, startDate: value, endDate: endStillValid ? f.endDate : "" };
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Time-of-day only matters for Hourly (see feedback: for Daily/Monthly
      // it's more intuitive that the picked dates are all that's asked for —
      // start of day is an implementation detail, not something a visitor
      // booking a whole day should have to think about).
      const requiredStartDate = isHourly ? `${form.startDate}T${form.startTime}` : `${form.startDate}T00:00`;
      const endDate = isHourly ? `${form.endDate}T${form.endTime}` : `${form.endDate}T00:00`;

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

  function toDateStr(d: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minStartDate = toDateStr(tomorrow);

  // Daily/Monthly: End Date can equal Start Date (a same-day, 1-day
  // booking) — only Hourly needs End strictly after Start, enforced via
  // the time fields below. Falls back to the Start-Date floor before a
  // Start Date is picked yet.
  const minEndDate = form.startDate || minStartDate;

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
          <select value={form.serviceType} onChange={(e) => update("serviceType", e.target.value)}>
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
          Start must be a later calendar day than today (BR-001/BR-002 — no backdating, no same-day requests).
        </p>
      </div>

      {isHourly && (
        <div className="field">
          <label>Parking Time</label>
          <div className="flex items-center gap-2">
            <input
              type="time"
              required
              disabled={!form.endDate}
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

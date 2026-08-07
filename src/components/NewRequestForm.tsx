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
    requiredStartDate: "",
    endDate: "",
    purpose: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateRequiredStartDate(value: string) {
    setForm((f) => {
      // Clear a now-invalid End Date rather than silently submitting a
      // start/end pair the server will reject anyway.
      const endStillValid = f.endDate && value && new Date(f.endDate) > new Date(value);
      return { ...f, requiredStartDate: value, endDate: endStillValid ? f.endDate : "" };
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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

  // datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time, not the UTC
  // string toISOString() gives — that would silently shift the min by the
  // visitor's UTC offset.
  function toDateTimeLocal(d: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const tomorrowStart = new Date();
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);
  const minStartDateTime = toDateTimeLocal(tomorrowStart);

  // End Date's minimum tracks whatever Start Date is currently picked (one
  // minute after it, so the widget itself can't offer an equal-to-start,
  // zero-duration option) — falls back to the same tomorrow floor before
  // Start Date has a value.
  const minEndDateTime = form.requiredStartDate
    ? toDateTimeLocal(new Date(new Date(form.requiredStartDate).getTime() + 60_000))
    : minStartDateTime;

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

      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Preferred Parking Location</label>
          <input required value={form.preferredParkingLocation} onChange={(e) => update("preferredParkingLocation", e.target.value)} />
        </div>
        <div className="field">
          <label>Required Start Date &amp; Time</label>
          <input
            type="datetime-local"
            required
            min={minStartDateTime}
            value={form.requiredStartDate}
            onChange={(e) => updateRequiredStartDate(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">Must be a later calendar day than today (BR-001/BR-002 — no backdating, no same-day requests).</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>End Date &amp; Time</label>
          <input
            type="datetime-local"
            required
            min={minEndDateTime}
            disabled={!form.requiredStartDate}
            value={form.endDate}
            onChange={(e) => update("endDate", e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">Must be after Required Start Date &amp; Time.</p>
        </div>
      </div>

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

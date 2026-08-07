"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SERVICE_TYPES } from "@/lib/types";

export default function NewRequestForm() {
  const router = useRouter();
  const [form, setForm] = useState({
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
      router.push(`/requests/${data.request.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  }

  const todayPlus1 = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Company Name</label>
          <input required value={form.companyName} onChange={(e) => update("companyName", e.target.value)} />
        </div>
        <div className="field">
          <label>Email Address</label>
          <input type="email" required value={form.emailAddress} onChange={(e) => update("emailAddress", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
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
        <div className="field">
          <label>Preferred Parking Location</label>
          <input required value={form.preferredParkingLocation} onChange={(e) => update("preferredParkingLocation", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Required Start Date</label>
          <input type="date" required min={todayPlus1} value={form.requiredStartDate} onChange={(e) => update("requiredStartDate", e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Must be after today (BR-001/BR-002 — no backdating, no same-day requests).</p>
        </div>
        <div className="field">
          <label>End Date</label>
          <input type="date" required value={form.endDate} onChange={(e) => update("endDate", e.target.value)} />
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

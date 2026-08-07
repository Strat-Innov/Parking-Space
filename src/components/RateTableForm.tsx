"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SERVICE_TYPES } from "@/lib/types";

export default function RateTableForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    serviceType: "Daily",
    chargingModel: "Daily",
    rateAmount: "",
    effectiveStartDate: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/rate-table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, rateAmount: Number(form.rateAmount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add rate version");
      router.refresh();
      setForm((f) => ({ ...f, rateAmount: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add rate version");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <h3 className="font-medium">Add new rate version</h3>
      <p className="text-xs text-slate-500">
        Append-only (Section 7): this always creates a new row. Existing rows are never edited — the current rate for a
        service type is resolved as the most recent row whose effective start date has passed.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Service Type</label>
          <select
            value={form.serviceType}
            onChange={(e) => setForm((f) => ({ ...f, serviceType: e.target.value, chargingModel: e.target.value }))}
          >
            {SERVICE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Rate Amount</label>
          <input type="number" min="0" step="0.01" required value={form.rateAmount} onChange={(e) => setForm((f) => ({ ...f, rateAmount: e.target.value }))} />
        </div>
      </div>
      <div className="field">
        <label>Effective Start Date</label>
        <input
          type="date"
          required
          value={form.effectiveStartDate}
          onChange={(e) => setForm((f) => ({ ...f, effectiveStartDate: e.target.value }))}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Saving..." : "Add Rate Version"}
      </button>
    </form>
  );
}

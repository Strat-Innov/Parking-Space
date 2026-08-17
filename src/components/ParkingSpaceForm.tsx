"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ParkingSpaceForm() {
  const router = useRouter();
  const [form, setForm] = useState({ location: "", slotNumber: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/parking-spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add parking space");
      router.refresh();
      setForm((f) => ({ ...f, slotNumber: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add parking space");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <h3 className="font-medium">Add new parking space</h3>
      <p className="text-xs text-slate-500">
        Unlike the Rate Table, this list is mutable — a space can be removed once it no longer exists, as long as it
        has no current or upcoming booking.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Parking Location</label>
          <input
            required
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            placeholder="e.g. Axis Basement Parking"
          />
        </div>
        <div className="field">
          <label>Parking Slot Number</label>
          <input
            required
            value={form.slotNumber}
            onChange={(e) => setForm((f) => ({ ...f, slotNumber: e.target.value }))}
            placeholder="e.g. A-11"
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Saving..." : "Add Parking Space"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function parseSlotNumbers(raw: string) {
  return Array.from(
    new Set(
      raw
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

export default function ParkingSpaceForm() {
  const router = useRouter();
  const [location, setLocation] = useState("");
  const [slotNumbersRaw, setSlotNumbersRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const slotNumbers = parseSlotNumbers(slotNumbersRaw);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      const res = await fetch("/api/parking-spaces/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, slotNumbers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add parking spaces");
      router.refresh();
      setSlotNumbersRaw("");
      const parts: string[] = [];
      if (data.created > 0) parts.push(`${data.created} added`);
      if (data.skipped?.length > 0) parts.push(`${data.skipped.length} already existed, skipped (${data.skipped.join(", ")})`);
      setStatus(parts.join(" — ") || "Nothing to add.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add parking spaces");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <h3 className="font-medium">Add parking spaces</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Unlike the Rate Table, this list is mutable — a space can be removed once it no longer exists, as long as it
        has no current or upcoming booking. List several slot numbers to add them all to the same location at once.
      </p>
      <div className="field">
        <label>Parking Location</label>
        <input required value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Axis Basement Parking" />
      </div>
      <div className="field">
        <label>Slot Numbers</label>
        <textarea
          required
          rows={3}
          value={slotNumbersRaw}
          onChange={(e) => setSlotNumbersRaw(e.target.value)}
          placeholder={"One per line or comma-separated, e.g.\nA-01, A-02, A-03"}
        />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {slotNumbers.length} slot{slotNumbers.length === 1 ? "" : "s"} will be added.
        </p>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {status && !error && <p className="text-sm text-emerald-600 dark:text-emerald-400">{status}</p>}
      <button type="submit" disabled={loading || slotNumbers.length === 0} className="btn-primary">
        {loading ? "Saving..." : slotNumbers.length > 1 ? `Add ${slotNumbers.length} Parking Spaces` : "Add Parking Space"}
      </button>
    </form>
  );
}

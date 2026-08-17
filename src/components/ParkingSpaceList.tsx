"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

export type ParkingSpaceRow = {
  id: string;
  location: string;
  slotNumber: string;
  isActive: boolean;
  isLockedNow: boolean;
  createdByName: string;
};

export default function ParkingSpaceList({ rows, canMaintain }: { rows: ParkingSpaceRow[]; canMaintain: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function onRemove(id: string) {
    if (!confirm("Remove this parking space? This can't be undone.")) return;
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/parking-spaces/${id}/remove`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove parking space");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove parking space");
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.location.toLowerCase().includes(q));
  }, [rows, query]);

  // One row per distinct location, aggregated from the filtered slots — the
  // same search box narrows both this summary and the detailed list below.
  const locations = useMemo(() => {
    const byLocation = new Map<
      string,
      { location: string; total: number; available: number; occupied: number; removed: number }
    >();
    for (const r of filtered) {
      const entry = byLocation.get(r.location) ?? { location: r.location, total: 0, available: 0, occupied: 0, removed: 0 };
      entry.total += 1;
      if (!r.isActive) entry.removed += 1;
      else if (r.isLockedNow) entry.occupied += 1;
      else entry.available += 1;
      byLocation.set(r.location, entry);
    }
    return Array.from(byLocation.values()).sort((a, b) => a.location.localeCompare(b.location));
  }, [filtered]);

  const colSpan = canMaintain ? 5 : 4;

  return (
    <div className="space-y-6">
      <div className="field max-w-sm">
        <label>Search by location</label>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Axis, Festival, Bloc 10..." />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Parking Locations</h2>
        <div className="card table-wrap overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Total Slots</th>
                <th>Available</th>
                <th>Occupied Now</th>
                <th>Removed</th>
              </tr>
            </thead>
            <tbody>
              {locations.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    No matching locations.
                  </td>
                </tr>
              )}
              {locations.map((l) => (
                <tr key={l.location}>
                  <td>{l.location}</td>
                  <td>{l.total}</td>
                  <td>{l.available}</td>
                  <td>{l.occupied}</td>
                  <td>{l.removed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Parking Slots</h2>
        <div className="card table-wrap overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>Parking Location</th>
                <th>Parking Slot Number</th>
                <th>Status</th>
                <th>Added By</th>
                {canMaintain && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="py-8 text-center text-slate-400">
                    No parking spaces match.
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className={!r.isActive ? "opacity-50" : ""}>
                  <td>{r.location}</td>
                  <td>{r.slotNumber}</td>
                  <td>
                    <StatusBadge value={!r.isActive ? "Removed" : r.isLockedNow ? "Occupied now" : "Available"} />
                  </td>
                  <td>{r.createdByName}</td>
                  {canMaintain && (
                    <td>
                      {r.isActive && (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => onRemove(r.id)}
                          className="text-sm font-medium text-red-600 underline hover:text-red-800"
                        >
                          {busyId === r.id ? "Removing..." : "Remove"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
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

  const colSpan = canMaintain ? 5 : 4;

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="py-8 text-center text-slate-400">
                  No parking spaces configured yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
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
  );
}

"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";
import { SERVICE_TYPES } from "@/lib/types";

type BookingInfo = { company: string; serviceType: string; until?: string; from?: string };

export type ParkingSpaceRow = {
  id: string;
  location: string;
  slotNumber: string;
  isActive: boolean;
  isLockedNow: boolean;
  currentBooking: BookingInfo | null;
  nextBooking: BookingInfo | null;
  createdByName: string;
};

const FILTERS = ["All", ...SERVICE_TYPES];

function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleString() : "";
}

export default function ParkingSpaceList({ rows, canMaintain }: { rows: ParkingSpaceRow[]; canMaintain: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [serviceFilter, setServiceFilter] = useState<string>("All");

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

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.location.toLowerCase().includes(q));
  }, [rows, query]);

  // One row per distinct location — the same search box narrows this
  // summary and each location's expanded slot list together.
  const locations = useMemo(() => {
    const byLocation = new Map<string, { location: string; total: number; available: number; occupied: number }>();
    for (const r of filteredRows) {
      const entry = byLocation.get(r.location) ?? { location: r.location, total: 0, available: 0, occupied: 0 };
      entry.total += 1;
      if (r.isActive) {
        if (r.isLockedNow) entry.occupied += 1;
        else entry.available += 1;
      }
      byLocation.set(r.location, entry);
    }
    return Array.from(byLocation.values()).sort((a, b) => a.location.localeCompare(b.location));
  }, [filteredRows]);

  function toggleExpand(location: string) {
    setExpanded((cur) => (cur === location ? null : location));
    setServiceFilter("All");
  }

  return (
    <div className="space-y-6">
      <div className="field max-w-sm">
        <label>Search by location</label>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Axis, Festival, Bloc 10..." />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Parking Locations</h2>
        <p className="mb-2 text-xs text-slate-500">Click a location to see its individual slots.</p>
        <div className="card table-wrap overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Location</th>
                <th>Total Slots</th>
                <th>Available</th>
                <th>Occupied Now</th>
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
              {locations.map((l) => {
                const isOpen = expanded === l.location;
                const slots = filteredRows
                  .filter((r) => r.location === l.location)
                  .filter((r) => serviceFilter === "All" || r.currentBooking?.serviceType === serviceFilter)
                  .sort((a, b) => a.slotNumber.localeCompare(b.slotNumber, undefined, { numeric: true }));

                return (
                  <Fragment key={l.location}>
                    <tr onClick={() => toggleExpand(l.location)} className="cursor-pointer">
                      <td className="w-6 text-slate-400">{isOpen ? "▾" : "▸"}</td>
                      <td className="font-medium text-slate-900">{l.location}</td>
                      <td>{l.total}</td>
                      <td>{l.available}</td>
                      <td>{l.occupied}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} className="bg-slate-50 p-4">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-slate-500">Filter by current booking:</span>
                            {FILTERS.map((f) => (
                              <button
                                key={f}
                                type="button"
                                onClick={() => setServiceFilter(f)}
                                className={`rounded-full px-3 py-1 text-xs font-medium ${
                                  serviceFilter === f
                                    ? "bg-slate-900 text-white"
                                    : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                                }`}
                              >
                                {f}
                              </button>
                            ))}
                          </div>

                          <div className="space-y-2">
                            {slots.length === 0 && <p className="text-sm text-slate-400">No slots match this filter.</p>}
                            {slots.map((s) => (
                              <div
                                key={s.id}
                                className={`flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm ${
                                  !s.isActive ? "opacity-50" : ""
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-medium">{s.slotNumber}</span>
                                  <StatusBadge value={!s.isActive ? "Removed" : s.isLockedNow ? "Occupied now" : "Available"} />
                                </div>
                                <div className="flex-1 text-right text-xs text-slate-500">
                                  {!s.isActive
                                    ? "Removed from inventory"
                                    : s.currentBooking
                                    ? `${s.currentBooking.company} (${s.currentBooking.serviceType}) — until ${fmt(s.currentBooking.until)}`
                                    : s.nextBooking
                                    ? `Available — next: ${s.nextBooking.company} (${s.nextBooking.serviceType}) from ${fmt(s.nextBooking.from)}`
                                    : "Available — no upcoming bookings"}
                                </div>
                                {canMaintain && s.isActive && (
                                  <button
                                    type="button"
                                    disabled={busyId === s.id}
                                    onClick={() => onRemove(s.id)}
                                    className="text-xs font-medium text-red-600 underline hover:text-red-800"
                                  >
                                    {busyId === s.id ? "Removing..." : "Remove"}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

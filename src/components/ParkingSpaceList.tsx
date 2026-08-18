"use client";

import { useEffect, useMemo, useState } from "react";
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

function LocationModal({
  location,
  slots,
  canMaintain,
  isDeveloper,
  busyId,
  onRemove,
  onDelete,
  onClose,
}: {
  location: string;
  slots: ParkingSpaceRow[];
  canMaintain: boolean;
  isDeveloper: boolean;
  busyId: string | null;
  onRemove: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState("All");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return slots
      .filter((s) => !q || s.slotNumber.toLowerCase().includes(q))
      .filter((s) => serviceFilter === "All" || s.currentBooking?.serviceType === serviceFilter)
      .sort((a, b) => a.slotNumber.localeCompare(b.slotNumber, undefined, { numeric: true }));
  }, [slots, query, serviceFilter]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="card max-h-[85vh] w-full max-w-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={location}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{location}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 space-y-3">
          <div className="field">
            <label>Search slot number</label>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. A-01" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Filter by current booking:</span>
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setServiceFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  serviceFilter === f
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {filtered.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No slots match.</p>}
          {filtered.map((s) => (
            <div
              key={s.id}
              className={`flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 ${
                !s.isActive ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono font-medium">{s.slotNumber}</span>
                <StatusBadge value={!s.isActive ? "Removed" : s.isLockedNow ? "Occupied now" : "Available"} />
              </div>
              <div className="flex-1 text-right text-xs text-slate-500 dark:text-slate-400">
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
                  className="text-xs font-medium text-red-600 underline hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                >
                  {busyId === s.id ? "Removing..." : "Remove"}
                </button>
              )}
              {isDeveloper && (
                <button
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => onDelete(s.id)}
                  className="text-xs font-medium text-red-600 underline hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                >
                  {busyId === s.id ? "..." : "Delete Permanently"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ParkingSpaceList({
  rows,
  canMaintain,
  isDeveloper = false,
}: {
  rows: ParkingSpaceRow[];
  canMaintain: boolean;
  isDeveloper?: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openLocation, setOpenLocation] = useState<string | null>(null);

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

  async function onDelete(id: string) {
    if (!confirm("Permanently delete this parking space? This cannot be undone.")) return;
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/parking-spaces/${id}/delete`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete parking space");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete parking space");
    } finally {
      setBusyId(null);
    }
  }

  // Filters which locations appear in the summary table below.
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.location.toLowerCase().includes(q));
  }, [rows, query]);

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

  const openLocationSlots = openLocation ? rows.filter((r) => r.location === openLocation) : [];

  return (
    <div className="space-y-6">
      <div className="field max-w-sm">
        <label>Filter locations</label>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Axis, Festival, Bloc 10..." />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {locations.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400 dark:text-slate-500">
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
                  <td>
                    <button
                      type="button"
                      onClick={() => setOpenLocation(l.location)}
                      className="text-sm font-medium text-slate-700 underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                    >
                      View Slots
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openLocation && (
        <LocationModal
          location={openLocation}
          slots={openLocationSlots}
          canMaintain={canMaintain}
          isDeveloper={isDeveloper}
          busyId={busyId}
          onRemove={onRemove}
          onDelete={onDelete}
          onClose={() => setOpenLocation(null)}
        />
      )}
    </div>
  );
}

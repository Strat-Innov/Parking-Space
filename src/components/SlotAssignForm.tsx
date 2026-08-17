"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AvailableSpace = { id: string; location: string; slotNumber: string };

// WF05, Parking Management — a plain field edit on the Slot Track card
// rather than a separate action panel, same treatment as PaymentConfirmForm
// for WF04. Only rendered while Status = "Approved" and Slot Status isn't
// already Assigned (see requests/[id]/page.tsx). Only spaces free for this
// request's exact date range are offered — an already-booked space for an
// overlapping period simply isn't a choice here, rather than a validation
// error after the fact.
export default function SlotAssignForm({
  requestId,
  preferredParkingLocation,
  availableSpaces,
}: {
  requestId: string;
  preferredParkingLocation: string;
  availableSpaces: AvailableSpace[];
}) {
  const router = useRouter();
  const [parkingSpaceId, setParkingSpaceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!parkingSpaceId) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/slot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parkingSpaceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to assign slot");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign slot");
    } finally {
      setLoading(false);
    }
  }

  if (availableSpaces.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No parking spaces are free for this request&apos;s dates. Add one, or wait for one to free up, on the{" "}
        <a href="/parking-locations" className="underline">
          Parking Location
        </a>{" "}
        page.
      </p>
    );
  }

  const preferred = preferredParkingLocation.trim().toLowerCase();
  const matches = availableSpaces.filter(
    (s) => preferred && (s.location.toLowerCase().includes(preferred) || preferred.includes(s.location.toLowerCase()))
  );
  const others = availableSpaces.filter((s) => !matches.includes(s));

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="field">
        <label>Parking space</label>
        <select required value={parkingSpaceId} onChange={(e) => setParkingSpaceId(e.target.value)}>
          <option value="" disabled>
            Select a space...
          </option>
          {matches.length > 0 && (
            <optgroup label={`Convenient — matches "${preferredParkingLocation}"`}>
              {matches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.location} — {s.slotNumber}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={matches.length > 0 ? "Other available spaces" : "Available spaces"}>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.location} — {s.slotNumber}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Saving..." : "Assign Slot"}
      </button>
    </form>
  );
}

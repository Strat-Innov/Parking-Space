"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SERVICE_TYPES } from "@/lib/types";
import { toDateStr, toTimeStr, minEndDateFor } from "@/lib/parking-date-helpers";

const OTHER_LOCATION = "__other__";

export type RequestDetailsFormInitial = {
  fullName: string;
  companyName: string;
  emailAddress: string;
  serviceType: string;
  preferredParkingLocation: string;
  requestedSlot?: string | null;
  requiredStartDate: string | Date;
  endDate: string | Date;
  purpose: string;
};

type FormState = {
  fullName: string;
  companyName: string;
  emailAddress: string;
  serviceType: string;
  preferredParkingLocation: string;
  requestedSlot: string; // optional — see Prisma schema comment on requestedSlot
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm — Hourly's Start Time, or the single shared Daily/Monthly check-in time
  endTime: string; // HH:mm — Hourly only
  purpose: string;
};

function blankForm(): FormState {
  return {
    fullName: "",
    companyName: "",
    emailAddress: "",
    serviceType: "Daily",
    preferredParkingLocation: "",
    requestedSlot: "",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    purpose: "",
  };
}

function fromInitial(initial: RequestDetailsFormInitial): FormState {
  const start = new Date(initial.requiredStartDate);
  const end = new Date(initial.endDate);
  const isHourly = initial.serviceType === "Hourly";
  return {
    fullName: initial.fullName,
    companyName: initial.companyName,
    emailAddress: initial.emailAddress,
    serviceType: initial.serviceType,
    preferredParkingLocation: initial.preferredParkingLocation,
    requestedSlot: initial.requestedSlot ?? "",
    startDate: toDateStr(start),
    endDate: toDateStr(end),
    startTime: toTimeStr(start),
    endTime: isHourly ? toTimeStr(end) : "",
    purpose: initial.purpose,
  };
}

export default function RequestDetailsForm({
  mode,
  requestId,
  initial,
  onSaved,
}: {
  mode: "create" | "edit";
  requestId?: string;
  initial?: RequestDetailsFormInitial;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<FormState>(initial ? fromInitial(initial) : blankForm());
  // Baseline to diff against for "is there anything to save" — reset to the
  // current form after each successful save, so Save Changes disappears
  // again until the next real edit.
  const [savedSnapshot, setSavedSnapshot] = useState<FormState>(form);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"save" | "endorse" | null>(null);
  const loading = busyAction !== null;
  const isDirty = JSON.stringify(form) !== JSON.stringify(savedSnapshot);

  const [locations, setLocations] = useState<string[]>([]);
  const [locationMode, setLocationMode] = useState<"select" | "other">("select");

  // Fed by the Parking Location inventory — always fetched fresh (not
  // baked in) so a space added after this page loaded still shows up.
  // Re-fetched on focus in case the form was left open while someone else
  // added one.
  useEffect(() => {
    let cancelled = false;
    async function loadLocations() {
      try {
        const res = await fetch("/api/parking-spaces/locations");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLocations(data.locations ?? []);
      } catch {
        // non-fatal — falls back to "Other" only
      }
    }
    loadLocations();
    window.addEventListener("focus", loadLocations);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", loadLocations);
    };
  }, []);

  // An existing value (edit mode, or a location later removed from the
  // inventory) that isn't in the fetched list needs the free-text fallback.
  useEffect(() => {
    if (locations.length > 0 && form.preferredParkingLocation && !locations.includes(form.preferredParkingLocation)) {
      setLocationMode("other");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  const isHourly = form.serviceType === "Hourly";

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function updateStartDate(value: string) {
    setForm((f) => {
      const min = minEndDateFor(value, f.serviceType);
      const endStillValid = f.endDate && value && f.endDate >= min;
      return { ...f, startDate: value, endDate: endStillValid ? f.endDate : "" };
    });
    setSaved(false);
  }

  function updateServiceType(value: string) {
    setForm((f) => {
      // Different types have different valid End Date floors (see
      // minEndDateFor) and different time-field shapes (Hourly: two
      // independent pickers; Daily/Monthly: one shared picker) — clear
      // anything that might now be stale rather than silently carry over a
      // combination the server would reject anyway.
      const min = minEndDateFor(f.startDate, value);
      const endStillValid = f.endDate && f.startDate && f.endDate >= min;
      return { ...f, serviceType: value, endDate: endStillValid ? f.endDate : "", endTime: "" };
    });
    setSaved(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Only the Prepared-By edit form needs a confirmation — a fresh public
    // submission (mode="create") shouldn't get extra friction on top of
    // the form itself.
    if (mode === "edit" && !confirm("Save these changes to the request?")) return;

    setError(null);
    setBusyAction("save");
    try {
      const data = await saveDetails();
      if (mode === "create") {
        setSubmittedId(data.request.id);
      } else {
        setSaved(true);
        setSavedSnapshot(form);
        router.refresh();
        onSaved?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function saveDetails() {
    // Hourly: independent Start/End times. Daily/Monthly: the single
    // "Time" field is mirrored onto both ends (a real check-in time, not
    // implicit midnight) so day/month boundaries — and later, overnight
    // billing — can be computed from it rather than assumed.
    const requiredStartDate = `${form.startDate}T${form.startTime}`;
    const endDate = isHourly ? `${form.endDate}T${form.endTime}` : `${form.endDate}T${form.startTime}`;

    const payload = {
      fullName: form.fullName,
      companyName: form.companyName,
      emailAddress: form.emailAddress,
      serviceType: form.serviceType,
      preferredParkingLocation: form.preferredParkingLocation,
      requestedSlot: form.requestedSlot || undefined,
      requiredStartDate,
      endDate,
      purpose: form.purpose,
    };

    const url = mode === "create" ? "/api/requests" : `/api/requests/${requestId}/edit`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Submission failed");
    return data;
  }

  // WF02 — sits next to Save Changes rather than as a separate action card,
  // since editing and endorsing both apply to exactly the same window
  // (Prepared By, Status = "In Preparation").
  async function onEndorse() {
    if (!confirm("Endorse this request for validation? You won't be able to edit these details afterward.")) return;
    setError(null);
    setBusyAction("endorse");
    try {
      // Save whatever's currently in the form first, so an endorse never
      // silently discards an edit still sitting in the fields.
      await saveDetails();
      const res = await fetch(`/api/requests/${requestId}/prepare`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      router.refresh();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyAction(null);
    }
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minStartDate = toDateStr(tomorrow);
  const minEndDate = minEndDateFor(form.startDate, form.serviceType) || minStartDate;

  // For Hourly, End Time only needs a floor when End Date == Start Date
  // (same-day booking) — a later End Date has no relationship to Start Time.
  const sameDayHourly = isHourly && form.startDate && form.endDate && form.startDate === form.endDate;
  const minEndTime = sameDayHourly && form.startTime ? form.startTime : undefined;

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
          <select value={form.serviceType} onChange={(e) => updateServiceType(e.target.value)}>
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
          {locationMode === "other" ? (
            <div className="space-y-1">
              <input
                required
                value={form.preferredParkingLocation}
                onChange={(e) => update("preferredParkingLocation", e.target.value)}
                placeholder="Type the location name"
              />
              {locations.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-slate-500 underline"
                  onClick={() => {
                    setLocationMode("select");
                    update("preferredParkingLocation", "");
                  }}
                >
                  Choose from the list instead
                </button>
              )}
            </div>
          ) : (
            <select
              required
              value={form.preferredParkingLocation}
              onChange={(e) => {
                if (e.target.value === OTHER_LOCATION) {
                  setLocationMode("other");
                  update("preferredParkingLocation", "");
                } else {
                  update("preferredParkingLocation", e.target.value);
                }
              }}
            >
              <option value="" disabled>
                Select a location...
              </option>
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
              <option value={OTHER_LOCATION}>Other (not listed yet)</option>
            </select>
          )}
        </div>
        <div className="field">
          <label>Parking Slot Number (optional)</label>
          <input
            value={form.requestedSlot}
            onChange={(e) => update("requestedSlot", e.target.value)}
            placeholder="e.g. B-14, if you have a preference"
          />
        </div>
      </div>

      <div className="field">
        <label>Parking Date</label>
        <div className="flex items-center gap-2">
          <input
            type="date"
            required
            min={minStartDate}
            value={form.startDate}
            onChange={(e) => updateStartDate(e.target.value)}
            className="flex-1"
          />
          <span className="text-slate-400">—</span>
          <input
            type="date"
            required
            min={minEndDate}
            disabled={!form.startDate}
            value={form.endDate}
            onChange={(e) => update("endDate", e.target.value)}
            className="flex-1"
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {form.serviceType === "Monthly"
            ? "Start must be a later calendar day than today, and End at least 1 month after Start (BR-001/BR-002)."
            : "Start must be a later calendar day than today (BR-001/BR-002 — no backdating, no same-day requests)."}
        </p>
      </div>

      {isHourly ? (
        <div className="field">
          <label>Parking Time</label>
          <div className="flex items-center gap-2">
            <input
              type="time"
              required
              disabled={!form.startDate}
              value={form.startTime}
              onChange={(e) => update("startTime", e.target.value)}
              className="flex-1"
            />
            <span className="text-slate-400">—</span>
            <input
              type="time"
              required
              min={minEndTime}
              disabled={!form.startTime}
              value={form.endTime}
              onChange={(e) => update("endTime", e.target.value)}
              className="flex-1"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">End Time must be after Start Time on the same day.</p>
        </div>
      ) : (
        <div className="field">
          <label>Time</label>
          <input
            type="time"
            required
            disabled={!form.startDate}
            value={form.startTime}
            onChange={(e) => update("startTime", e.target.value)}
            className="w-40"
          />
          <p className="mt-1 text-xs text-slate-500">
            Check-in time — applied to both the start and end date, so the parking period is a real 24-hour cycle from this time
            rather than midnight.
          </p>
        </div>
      )}

      <div className="field">
        <label>Purpose</label>
        <textarea required rows={3} value={form.purpose} onChange={(e) => update("purpose", e.target.value)} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && !error && <p className="text-sm text-emerald-600">Saved.</p>}

      <div className="flex items-center gap-3">
        {(mode === "create" || isDirty) && (
          <button type="submit" disabled={loading} className="btn-primary">
            {busyAction === "save" ? "Saving..." : mode === "create" ? "Submit Request" : "Save Changes"}
          </button>
        )}
        {mode === "edit" && (
          <button type="button" disabled={loading} onClick={onEndorse} className="btn-secondary">
            {busyAction === "endorse" ? "Endorsing..." : "Endorse for Validation"}
          </button>
        )}
      </div>
    </form>
  );
}

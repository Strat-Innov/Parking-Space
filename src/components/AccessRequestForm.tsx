"use client";

import { useState } from "react";
import { ENROLLMENT_TYPES, ACCESS_REQUEST_TYPES, ACCESS_TYPES } from "@/lib/access-types";

type FormState = {
  enrollmentType: string;
  requestType: string;
  transferTo: string;
  transferFrom: string;
  fullName: string;
  companyName: string;
  emailAddress: string;
  vehiclePlateNumber: string;
  propertyLocation: string;
  contactNumber: string;
  requestedQuantity: string;
  accessType: string;
  remarks: string;
  approverName: string;
};

function blankForm(): FormState {
  return {
    enrollmentType: "Individual",
    requestType: "New Enrollment",
    transferTo: "",
    transferFrom: "",
    fullName: "",
    companyName: "",
    emailAddress: "",
    vehiclePlateNumber: "",
    propertyLocation: "",
    contactNumber: "",
    requestedQuantity: "1",
    accessType: "RFID Sticker/Card/Metal Tag",
    remarks: "",
    approverName: "",
  };
}

export default function AccessRequestForm() {
  const [form, setForm] = useState<FormState>(blankForm());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isTransfer = form.requestType === "Transfer";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload = {
        ...form,
        requestedQuantity: Number(form.requestedQuantity),
        transferTo: isTransfer ? form.transferTo : undefined,
        transferFrom: isTransfer ? form.transferFrom : undefined,
        remarks: form.remarks || undefined,
        approverName: form.approverName || undefined,
      };
      const res = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Submission failed");
      setSubmittedId(data.request.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  }

  if (submittedId) {
    return (
      <div className="card space-y-3 text-center">
        <h2 className="text-lg font-semibold tracking-tight">Enrollment submitted</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Thanks, {form.fullName} — your parking access enrollment for <strong>{form.companyName}</strong> has been
          received and is now in review.
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Reference: <span className="font-mono">{submittedId}</span>
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Keep this reference for your records. You&apos;ll be contacted at {form.emailAddress}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Enrollment Type</label>
          <select value={form.enrollmentType} onChange={(e) => update("enrollmentType", e.target.value)}>
            {ENROLLMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Type of Request</label>
          <select value={form.requestType} onChange={(e) => update("requestType", e.target.value)}>
            {ACCESS_REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isTransfer && (
        <div className="grid grid-cols-2 gap-4">
          <div className="field">
            <label>Transfer To</label>
            <input required value={form.transferTo} onChange={(e) => update("transferTo", e.target.value)} />
          </div>
          <div className="field">
            <label>Transfer From</label>
            <input required value={form.transferFrom} onChange={(e) => update("transferFrom", e.target.value)} />
          </div>
        </div>
      )}

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
          <label>Contact Number</label>
          <input required value={form.contactNumber} onChange={(e) => update("contactNumber", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Vehicle Plate Number / Model / Class</label>
          <input
            required
            value={form.vehiclePlateNumber}
            onChange={(e) => update("vehiclePlateNumber", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Property Location</label>
          <input required value={form.propertyLocation} onChange={(e) => update("propertyLocation", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Type of Access</label>
          <select value={form.accessType} onChange={(e) => update("accessType", e.target.value)}>
            {ACCESS_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>No. of Purchase</label>
          <input
            type="number"
            min="1"
            step="1"
            required
            value={form.requestedQuantity}
            onChange={(e) => update("requestedQuantity", e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label>Requestor&apos;s Authorized Approver (optional)</label>
        <input
          value={form.approverName}
          onChange={(e) => update("approverName", e.target.value)}
          placeholder="Name of your company's approving signatory"
        />
      </div>

      <div className="field">
        <label>Remarks (optional)</label>
        <textarea rows={2} value={form.remarks} onChange={(e) => update("remarks", e.target.value)} />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Submitting..." : "Submit Enrollment"}
      </button>
    </form>
  );
}

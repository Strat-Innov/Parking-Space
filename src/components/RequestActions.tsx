"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/lib/types";

type RequestShape = {
  id: string;
  requesterId: string;
  status: string;
  paymentStatus: string;
  slotStatus: string;
};

async function call(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Action failed");
  return data;
}

function ActionShell({
  title,
  children,
  onSubmit,
  loading,
  error,
  submitLabel,
  danger,
}: {
  title: string;
  children?: React.ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
  error: string | null;
  submitLabel: string;
  danger?: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="card space-y-3">
      <h3 className="font-medium">{title}</h3>
      {children}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={loading} className={danger ? "btn-danger" : "btn-primary"}>
        {loading ? "Working..." : submitLabel}
      </button>
    </form>
  );
}

export default function RequestActions({ request, role, userId }: { request: RequestShape; role: Role; userId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [receiptRef, setReceiptRef] = useState("");
  const [slot, setSlot] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setLoading(true);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
    }
  }

  const panels: React.ReactNode[] = [];

  // WF02 — Prepared By
  if (role === "PREPARED_BY" && request.status === "In Preparation") {
    panels.push(
      <ActionShell
        key="wf02"
        title="Endorse for validation (WF02)"
        loading={loading}
        error={error}
        submitLabel="Endorse for Validation"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => call(`/api/requests/${request.id}/prepare`));
        }}
      />
    );
  }

  // WF03 — Validated By
  if (role === "VALIDATED_BY" && request.status === "Pending Approval") {
    panels.push(
      <ActionShell
        key="wf03-approve"
        title="Approve (WF03)"
        loading={loading}
        error={error}
        submitLabel="Approve"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => call(`/api/requests/${request.id}/decision`, { decision: "Approved" }));
        }}
      />
    );
    panels.push(
      <ActionShell
        key="wf03-reject"
        title="Reject — returns to In Preparation (WF03, BR-004)"
        loading={loading}
        error={error}
        submitLabel="Reject"
        danger
        onSubmit={(e) => {
          e.preventDefault();
          run(() => call(`/api/requests/${request.id}/decision`, { decision: "Rejected", rejectionReason }));
        }}
      >
        <div className="field">
          <label>Rejection reason</label>
          <textarea required rows={2} value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
        </div>
      </ActionShell>
    );
  }

  // WF04 — Cashier (independent track, BR-006)
  if (role === "CASHIER" && request.status === "Approved" && request.paymentStatus !== "Confirmed") {
    if (request.paymentStatus === "Not Started") {
      panels.push(
        <ActionShell
          key="wf04-start"
          title="Start payment processing (WF04)"
          loading={loading}
          error={error}
          submitLabel="Start Payment"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => call(`/api/requests/${request.id}/payment`, { action: "start" }));
          }}
        />
      );
    } else {
      panels.push(
        <ActionShell
          key="wf04-confirm"
          title="Confirm payment (WF04)"
          loading={loading}
          error={error}
          submitLabel="Confirm Payment"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => call(`/api/requests/${request.id}/payment`, { action: "confirm", officialReceiptReference: receiptRef }));
          }}
        >
          <div className="field">
            <label>Official Receipt Reference</label>
            <input required value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} />
          </div>
        </ActionShell>
      );
    }
  }

  // WF05 — Parking Management (independent track, BR-006)
  if (role === "PARKING_MANAGEMENT" && request.status === "Approved" && request.slotStatus !== "Assigned") {
    panels.push(
      <ActionShell
        key="wf05"
        title="Assign parking slot (WF05)"
        loading={loading}
        error={error}
        submitLabel="Assign Slot"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => call(`/api/requests/${request.id}/slot`, { assignedSlot: slot }));
        }}
      >
        <div className="field">
          <label>Slot / space number</label>
          <input required value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="e.g. B-14" />
        </div>
      </ActionShell>
    );
  }

  // Cancel — any non-terminal state, staff (other than Prepared By — see
  // below) or the owning requestor
  const canCancel =
    request.status !== "Completed" &&
    request.status !== "Cancelled" &&
    role !== "PREPARED_BY" &&
    (role !== "REQUESTER" || request.requesterId === userId);
  if (canCancel) {
    panels.push(
      <ActionShell
        key="cancel"
        title="Cancel request"
        loading={loading}
        error={error}
        submitLabel="Cancel Request"
        danger
        onSubmit={(e) => {
          e.preventDefault();
          if (!confirm("Cancel this request? This cannot be undone.")) return;
          run(() => call(`/api/requests/${request.id}/cancel`));
        }}
      />
    );
  }

  if (panels.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Actions</h2>
      {panels}
    </div>
  );
}

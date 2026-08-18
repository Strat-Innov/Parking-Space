"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/lib/types";

type RequestShape = {
  id: string;
  status: string;
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
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={loading} className={danger ? "btn-danger" : "btn-primary"}>
        {loading ? "Working..." : submitLabel}
      </button>
    </form>
  );
}

export default function RequestActions({ request, role }: { request: RequestShape; role: Role }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

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

  // WF02 — Prepared By: moved into RequestDetailsForm, next to Save
  // Changes, since editing and endorsing apply to exactly the same window
  // (Status = "In Preparation") and belong together.

  // WF03 — Validated By
  if (role === "VALIDATED_BY" && request.status === "Pending Approval") {
    panels.push(
      <ActionShell
        key="wf03-approve"
        title="Approve"
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
        title="Reject — returns to In Preparation"
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

  // WF04 — Prepared By confirms payment inline on the Payment Track card
  // (see PaymentConfirmForm in requests/[id]/page.tsx), not here — it's a
  // field edit, not a standalone action.

  // WF05 — Parking Management confirms the slot inline on the Slot Track
  // card (see SlotAssignForm in requests/[id]/page.tsx), same treatment as
  // WF04 above, not here.

  // Cancel — moved to CancelRequestAction, rendered at the very bottom of
  // the page instead of grouped with these stage-specific panels.

  if (panels.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Actions</h2>
      {panels}
    </div>
  );
}

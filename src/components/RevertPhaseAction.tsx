"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REVERTIBLE_STATUSES, type Role } from "@/lib/types";

// Developer-only escape hatch — moves a request one phase backward and
// unwinds whatever that phase set (see wfDevRevertPhase in workflows.ts for
// exactly what gets cleared). Deliberately separate from RequestActions and
// CancelRequestAction: this bypasses the normal single-owner-per-stage
// workflow rather than advancing it, so it doesn't belong grouped with them.
export default function RevertPhaseAction({ requestId, status, role }: { requestId: string; status: string; role: Role }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (role !== "DEVELOPER" || !REVERTIBLE_STATUSES.includes(status as (typeof REVERTIBLE_STATUSES)[number])) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`Revert this request one phase back from "${status}"? Anything that phase set (payment/slot/rate snapshot, as applicable) will be cleared.`)) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/revert-phase`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3 border-amber-200 dark:border-amber-900">
      <h3 className="font-medium">Developer: Revert 1 Phase</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Moves this request back to the phase before "{status}". Only visible to Developer accounts.
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={loading} className="btn-danger">
        {loading ? "Working..." : "Revert 1 Phase"}
      </button>
    </form>
  );
}

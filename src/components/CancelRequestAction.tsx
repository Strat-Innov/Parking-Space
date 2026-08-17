"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/lib/types";

// Deliberately separate from RequestActions and rendered at the very
// bottom of the page — cancellation is reachable from any non-terminal
// state regardless of what workflow stage a request is in, so it doesn't
// belong grouped with (and above) the stage-specific action panels.
export default function CancelRequestAction({ requestId, status, role }: { requestId: string; status: string; role: Role }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prepared By is deliberately excluded — they prepare/edit or endorse a
  // request, but cancelling it isn't their call. Requestors never log in,
  // so there's no self-cancel path either.
  const canCancel = status !== "Completed" && status !== "Cancelled" && role !== "PREPARED_BY";
  if (!canCancel) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm("Cancel this request? This cannot be undone.")) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/cancel`, { method: "POST" });
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
    <form onSubmit={onSubmit} className="card space-y-3">
      <h3 className="font-medium">Cancel request</h3>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={loading} className="btn-danger">
        {loading ? "Working..." : "Cancel Request"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Reachable from any non-terminal state, any staff role — same policy as
// CancelRequestAction for Parking Space, just no Prepared-By-equivalent
// exclusion here since Parking Access has no such role in its flow.
export default function CancelAccessRequestAction({ requestId, status }: { requestId: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "Completed" || status === "Cancelled") return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm("Cancel this access request? This cannot be undone.")) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/access-requests/${requestId}/cancel`, { method: "POST" });
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
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={loading} className="btn-danger">
        {loading ? "Working..." : "Cancel Request"}
      </button>
    </form>
  );
}

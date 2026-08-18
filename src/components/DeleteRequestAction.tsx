"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/lib/types";

// Developer-only, permanent — unlike Cancel (which just sets Status =
// Cancelled and keeps the row), this actually removes the request and its
// event log. For cleaning up test/trial data, not a normal workflow action.
export default function DeleteRequestAction({ requestId, role }: { requestId: string; role: Role }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (role !== "DEVELOPER") return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm("Permanently delete this request and its entire event history? This cannot be undone.")) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/delete`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3 border-red-200 dark:border-red-900">
      <h3 className="font-medium">Developer: Delete Request</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Permanently removes this request and its event history — unlike Cancel, this cannot be undone. Only visible
        to Developer accounts.
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={loading} className="btn-danger">
        {loading ? "Working..." : "Delete Request"}
      </button>
    </form>
  );
}

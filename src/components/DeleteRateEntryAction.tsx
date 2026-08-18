"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Developer-only, permanent — Rate Table is normally append-only (Section
// 7: existing rows are never edited or removed), but stray/test entries
// still need a real way out. Blocked server-side if any request snapshotted
// this exact version, so it can never corrupt a request's recorded rate.
export default function DeleteRateEntryAction({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onClick() {
    if (!confirm("Permanently delete this rate table entry? This cannot be undone.")) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/rate-table/${id}/delete`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete rate entry");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rate entry");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={onClick} disabled={loading} className="btn-danger py-1 text-xs">
        {loading ? "..." : "Delete"}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}

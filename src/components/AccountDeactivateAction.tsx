"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AccountDeactivateAction({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${id}/${active ? "deactivate" : "reactivate"}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update account");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={onClick} disabled={loading} className="btn-secondary py-1 text-xs">
        {loading ? "..." : active ? "Deactivate" : "Reactivate"}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}

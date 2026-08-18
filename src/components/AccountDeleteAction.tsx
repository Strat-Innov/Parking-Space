"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AccountDeleteAction({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onClick() {
    if (!confirm(`Permanently delete ${name}'s account? This cannot be undone.`)) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${id}/delete`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete account");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account");
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

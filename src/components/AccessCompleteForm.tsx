"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// AWF03, Parking Management — records that the client received the access
// in good order (the client has no login to confirm this themselves). Only
// rendered while Status = "Processed" (see access/[id]/page.tsx).
export default function AccessCompleteForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [receivedByName, setReceivedByName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/access-requests/${requestId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receivedByName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to confirm receipt");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm receipt");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="field">
        <label>Received By (printed name)</label>
        <input required value={receivedByName} onChange={(e) => setReceivedByName(e.target.value)} placeholder="Client's printed name" />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Saving..." : "Confirm Received (AWF03)"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// WF04, owned by Prepared By — a plain field edit on the Payment Track card
// rather than a separate action panel. Only rendered while Status =
// "Approved" and Payment Status isn't already Confirmed (see
// requests/[id]/page.tsx).
export default function PaymentConfirmForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [officialReceiptReference, setOfficialReceiptReference] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officialReceiptReference, payDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to confirm payment");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm payment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="field">
        <label>Official Receipt Reference</label>
        <input
          required
          value={officialReceiptReference}
          onChange={(e) => setOfficialReceiptReference(e.target.value)}
          placeholder="e.g. OR-2026-00142"
        />
      </div>
      <div className="field">
        <label>Pay Date</label>
        <input type="date" required value={payDate} onChange={(e) => setPayDate(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Saving..." : "Confirm Payment"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// AWF02, Parking Management — validates/endorses and issues the access in
// one combined action, matching the paper form's single "Validation of
// Document & Access Endorsement" box. Only rendered while Status =
// "Submitted" (see access/[id]/page.tsx).
export default function AccessProcessForm({ requestId, defaultQuantity }: { requestId: string; defaultQuantity: number }) {
  const router = useRouter();
  const [confirmedQuantity, setConfirmedQuantity] = useState(String(defaultQuantity));
  const [accessSeriesRef, setAccessSeriesRef] = useState("");
  const [purchasedCharge, setPurchasedCharge] = useState("");
  const [officialReceiptRef, setOfficialReceiptRef] = useState("");
  const [staffRemarks, setStaffRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/access-requests/${requestId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmedQuantity: Number(confirmedQuantity),
          accessSeriesRef,
          purchasedCharge: Number(purchasedCharge || 0),
          officialReceiptRef,
          staffRemarks: staffRemarks || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to process request");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process request");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Qty Purchase</label>
          <input
            type="number"
            min="1"
            step="1"
            required
            value={confirmedQuantity}
            onChange={(e) => setConfirmedQuantity(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Access Series/Ref.</label>
          <input required value={accessSeriesRef} onChange={(e) => setAccessSeriesRef(e.target.value)} placeholder="e.g. RFID-000123" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Purchased Charge (Php)</label>
          <input type="number" min="0" step="0.01" required value={purchasedCharge} onChange={(e) => setPurchasedCharge(e.target.value)} />
        </div>
        <div className="field">
          <label>OR No.</label>
          <input required value={officialReceiptRef} onChange={(e) => setOfficialReceiptRef(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Remarks (optional)</label>
        <textarea rows={2} value={staffRemarks} onChange={(e) => setStaffRemarks(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Saving..." : "Validate & Endorse (AWF02)"}
      </button>
    </form>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import { STATUSES, SERVICE_TYPES } from "@/lib/types";

export type OtherRequestRow = {
  id: string;
  companyName: string;
  serviceType: string;
  status: string;
  approvalStage: string;
  paymentStatus: string;
  slotStatus: string;
  requiredStartDate: string; // ISO
};

// Search/filter are client-side (the full "Other Requests" set is already
// fetched); export hands the same criteria to the server so the file always
// matches what's currently on screen, re-derived from the DB rather than
// the rows already in the browser.
export default function OtherRequestsPanel({ rows }: { rows: OtherRequestRow[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [serviceType, setServiceType] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.companyName.toLowerCase().includes(q)) return false;
      if (status && r.status !== status) return false;
      if (serviceType && r.serviceType !== serviceType) return false;
      return true;
    });
  }, [rows, search, status, serviceType]);

  function exportHref(format: "csv" | "xlsx" | "pdf") {
    const params = new URLSearchParams({ format });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (serviceType) params.set("serviceType", serviceType);
    return `/api/requests/export?${params.toString()}`;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="field max-w-xs">
          <label>Search company</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. FAI" />
        </div>
        <div className="field w-40">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field w-40">
          <label>Service Type</label>
          <select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
            <option value="">All</option>
            {SERVICE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          <a href={exportHref("csv")} className="btn-secondary py-1.5">
            Export CSV
          </a>
          <a href={exportHref("xlsx")} className="btn-secondary py-1.5">
            Export XLSX
          </a>
          <a href={exportHref("pdf")} className="btn-secondary py-1.5">
            Export PDF
          </a>
        </div>
      </div>

      <div className="card table-wrap overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Service</th>
              <th>Status</th>
              <th>Approval Stage</th>
              <th>Payment</th>
              <th>Slot</th>
              <th>Required Start</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400 dark:text-slate-500">
                  {rows.length === 0 ? "No other requests." : "No requests match these filters."}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>{r.companyName}</td>
                <td>{r.serviceType}</td>
                <td>
                  <StatusBadge value={r.status} />
                </td>
                <td>
                  <StatusBadge value={r.approvalStage} />
                </td>
                <td>
                  <StatusBadge value={r.paymentStatus} />
                </td>
                <td>
                  <StatusBadge value={r.slotStatus} />
                </td>
                <td>{new Date(r.requiredStartDate).toLocaleDateString()}</td>
                <td>
                  <Link
                    href={`/requests/${r.id}`}
                    className="text-sm font-medium text-slate-700 underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

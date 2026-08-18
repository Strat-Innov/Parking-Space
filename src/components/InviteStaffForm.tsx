"use client";

import { useState } from "react";
import { ROLE_LABELS, STAFF_ROLES } from "@/lib/types";

type Row = { name: string; email: string; role: string };
type Result = { email: string; status: "sent" | "skipped" | "failed"; reason?: string };

function emptyRow(): Row {
  return { name: "", email: "", role: STAFF_ROLES[0] };
}

export default function InviteStaffForm() {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResults(null);
    const invites = rows.filter((r) => r.name.trim() && r.email.trim());
    if (invites.length === 0) {
      setError("Add at least one name and email.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/accounts/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invites }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send invites");
      setResults(data.results);
      setRows([emptyRow()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invites");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        <h3 className="font-medium">Invite staff by email</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Each person gets an email with a link to set their own password — nothing to communicate out of band.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2">
            <div className="field">
              {i === 0 && <label>Name</label>}
              <input required={false} value={row.name} onChange={(e) => updateRow(i, { name: e.target.value })} />
            </div>
            <div className="field">
              {i === 0 && <label>Email</label>}
              <input
                type="email"
                value={row.email}
                onChange={(e) => updateRow(i, { email: e.target.value })}
                placeholder="name@filinvestcity.com"
              />
            </div>
            <div className="field">
              {i === 0 && <label>Role</label>}
              <select value={row.role} onChange={(e) => updateRow(i, { role: e.target.value })}>
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={rows.length === 1}
              className="btn-secondary py-1.5 disabled:opacity-40"
              aria-label="Remove row"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      <button type="button" onClick={() => setRows((rs) => [...rs, emptyRow()])} className="btn-secondary py-1.5">
        + Add another row
      </button>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {results && (
        <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
          {results.map((r) => (
            <li key={r.email} className={r.status === "sent" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
              {r.email} — {r.status === "sent" ? "invite sent" : r.reason ?? r.status}
            </li>
          ))}
        </ul>
      )}

      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Sending..." : "Send Invites"}
      </button>
    </form>
  );
}

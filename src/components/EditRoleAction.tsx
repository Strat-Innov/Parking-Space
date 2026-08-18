"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/types";

export default function EditRoleAction({ id, currentRole }: { id: string; currentRole: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(currentRole);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSave() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${id}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to change role");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change role");
    } finally {
      setLoading(false);
    }
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="btn-secondary py-1 text-xs">
        Edit Role
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select value={role} onChange={(e) => setRole(e.target.value)} className="text-xs">
        {ASSIGNABLE_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <button type="button" onClick={onSave} disabled={loading} className="btn-primary py-1 text-xs">
        {loading ? "..." : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="btn-secondary py-1 text-xs">
        Cancel
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS, STAFF_ROLES } from "@/lib/types";

// Developer is exclusive — it already has its own full admin reach (account
// management, phase-revert), so it's never combined with the 3 workflow
// roles here. Checking it clears/disables the others and vice versa;
// enforced again server-side in /api/accounts/[id]/role.
export default function EditRoleAction({ id, currentRoles }: { id: string; currentRoles: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [roles, setRoles] = useState<string[]>(currentRoles);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function toggle(role: string) {
    if (role === "DEVELOPER") {
      setRoles((r) => (r.includes("DEVELOPER") ? [] : ["DEVELOPER"]));
      return;
    }
    setRoles((r) => {
      const withoutDeveloper = r.filter((x) => x !== "DEVELOPER");
      return withoutDeveloper.includes(role) ? withoutDeveloper.filter((x) => x !== role) : [...withoutDeveloper, role];
    });
  }

  async function onSave() {
    if (roles.length === 0) {
      setError("Select at least one role.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${id}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles }),
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

  const developerSelected = roles.includes("DEVELOPER");

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700">
        {STAFF_ROLES.map((r) => (
          <label key={r} className={`flex items-center gap-1 text-xs ${developerSelected ? "opacity-40" : ""}`}>
            <input
              type="checkbox"
              checked={roles.includes(r)}
              disabled={developerSelected}
              onChange={() => toggle(r)}
            />
            {ROLE_LABELS[r]}
          </label>
        ))}
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={developerSelected} onChange={() => toggle("DEVELOPER")} />
          {ROLE_LABELS.DEVELOPER}
        </label>
      </span>
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

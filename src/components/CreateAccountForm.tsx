"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS, STAFF_ROLES } from "@/lib/types";

export default function CreateAccountForm({ allowDeveloperRole = false }: { allowDeveloperRole?: boolean }) {
  const roleOptions = allowDeveloperRole ? [...STAFF_ROLES, "DEVELOPER" as const] : STAFF_ROLES;
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: STAFF_ROLES[0] as string });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create account");
      router.refresh();
      setForm({ name: "", email: "", password: "", role: STAFF_ROLES[0] });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <h3 className="font-medium">Add staff account</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Full Name</label>
          <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="name@parking.local"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="field">
          <label>Temporary Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
        </div>
        <div className="field">
          <label>Role</label>
          <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">Account created.</p>}
      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Creating..." : "Create Account"}
      </button>
    </form>
  );
}

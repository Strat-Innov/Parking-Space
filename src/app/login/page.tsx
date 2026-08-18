"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type System = "space" | "access";

export default function LoginPage() {
  const router = useRouter();
  const [system, setSystem] = useState<System>("space");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Login failed");
      // Same staff accounts work both systems — this only picks which
      // dashboard you land on first, not a separate permission set.
      router.push(system === "access" ? "/access/dashboard" : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Parking Space</h1>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Parking Space Request Automation — sign in</p>

      <div className="field mb-6">
        <label>System</label>
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
          {(
            [
              { value: "space", label: "Parking Space" },
              { value: "access", label: "Parking Access (RFID/Card/Metal Tag)" },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setSystem(o.value)}
              aria-pressed={system === o.value}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                system === o.value
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="field">
          <label>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@parking.local" />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DEMO_ACCOUNTS = [
  { label: "Prepared By", email: "prepared@parking.local" },
  { label: "Validated By", email: "validator@parking.local" },
  { label: "Parking Management", email: "parkingmgmt@parking.local" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("demo1234");
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
      router.push("/dashboard");
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
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Parking Space Request Automation — sign in</p>

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

      <div className="mt-6 text-xs text-slate-500 dark:text-slate-400">
        <p className="mb-2 font-medium text-slate-600 dark:text-slate-300">Demo accounts (password: demo1234)</p>
        <ul className="space-y-1">
          {DEMO_ACCOUNTS.map((a) => (
            <li key={a.email}>
              <button
                type="button"
                className="underline hover:text-slate-900 dark:hover:text-slate-100"
                onClick={() => setEmail(a.email)}
              >
                {a.label}
              </button>{" "}
              — {a.email}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

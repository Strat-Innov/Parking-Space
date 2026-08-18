"use client";

import { useState } from "react";
import Link from "next/link";

export default function SignupPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password !== confirmPassword) {
      setError("Password and confirmation do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/accounts/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create account");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="card mt-4 text-sm text-slate-600 dark:text-slate-300">
          We sent a confirmation link to <span className="font-medium">{form.email}</span>. Click it to activate
          your account, then come back to{" "}
          <Link href="/login" className="underline hover:text-slate-900 dark:hover:text-slate-100">
            sign in
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Create Account</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        For internal staff only. New accounts start as Prepared By — ask a colleague to grant a higher role afterward
        if needed.
      </p>

      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="field">
          <label>Full Name</label>
          <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="field">
          <label>Work Email</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="you@filinvestcity.com"
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
        </div>
        <div className="field">
          <label>Confirm Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Creating account..." : "Create Account"}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
        Already have an account?{" "}
        <Link href="/login" className="underline hover:text-slate-900 dark:hover:text-slate-100">
          Sign in
        </Link>
      </p>
    </div>
  );
}

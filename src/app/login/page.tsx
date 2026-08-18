"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type System = "space" | "access";

const VERIFY_ERROR_MESSAGES: Record<string, string> = {
  missing: "That confirmation link is missing its token.",
  invalid: "That confirmation link is invalid or has expired. Request a new one below.",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [system, setSystem] = useState<System>("space");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  const justVerified = searchParams.get("verified") === "1";
  const justAccepted = searchParams.get("accepted") === "1";
  const verifyError = searchParams.get("verifyError");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUnconfirmed(false);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.unconfirmed) setUnconfirmed(true);
        throw new Error(data.error ?? "Login failed");
      }
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

  async function onResend() {
    setResendState("sending");
    try {
      await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      setResendState("sent");
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Parking Space</h1>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Parking Space Request Automation — sign in</p>

      {justVerified && (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
          Email confirmed — you can now sign in.
        </p>
      )}
      {justAccepted && (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
          Your account is active — sign in with your new password.
        </p>
      )}
      {verifyError && !justVerified && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
          {VERIFY_ERROR_MESSAGES[verifyError] ?? "There was a problem confirming your email."}
        </p>
      )}

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
        {unconfirmed && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
            {resendState === "sent" ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                If that email has a pending confirmation, a new link is on its way.
              </p>
            ) : (
              <button
                type="button"
                onClick={onResend}
                disabled={resendState === "sending" || !email}
                className="text-sm underline hover:text-slate-900 dark:hover:text-slate-100"
              >
                {resendState === "sending" ? "Sending..." : "Resend confirmation email"}
              </button>
            )}
          </div>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
        New staff member?{" "}
        <Link href="/signup" className="underline hover:text-slate-900 dark:hover:text-slate-100">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ROLE_LABELS, type Role } from "@/lib/types";
import PasswordInput from "@/components/PasswordInput";

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
  // Set once the server says this account holds more than one role — the
  // form then asks which to act as, using the same credentials already
  // verified, rather than a separate "second login."
  const [roleChoices, setRoleChoices] = useState<string[] | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("");

  const justVerified = searchParams.get("verified") === "1";
  const justAccepted = searchParams.get("accepted") === "1";
  const verifyError = searchParams.get("verifyError");

  async function attemptLogin(withRole?: string) {
    setError(null);
    setUnconfirmed(false);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(withRole ? { selectedRole: withRole } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.unconfirmed) setUnconfirmed(true);
        throw new Error(data.error ?? "Login failed");
      }
      if (data.multiRole) {
        setRoleChoices(data.roles);
        setSelectedRole(data.roles[0]);
        return;
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    attemptLogin();
  }

  function onConfirmRole(e: React.FormEvent) {
    e.preventDefault();
    attemptLogin(selectedRole);
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

  if (roleChoices) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Choose Access Point</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          This account holds more than one role. Pick which one to sign in as — you can sign out and pick a
          different one later.
        </p>

        <form onSubmit={onConfirmRole} className="card space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Role</p>
            <div className="space-y-2">
              {roleChoices.map((r) => (
                <label
                  key={r}
                  className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"
                >
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    checked={selectedRole === r}
                    onChange={() => setSelectedRole(r)}
                    className="h-4 w-4 shrink-0"
                  />
                  {ROLE_LABELS[r as Role] ?? r}
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRoleChoices(null)}
              className="btn-secondary flex-1"
            >
              Back
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? "Signing in..." : "Continue"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">ParkServe</h1>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Parking Request & Access Management Portal</p>

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
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@parkingproinc.com" />
        </div>
        <div className="field">
          <label>Password</label>
          <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} />
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

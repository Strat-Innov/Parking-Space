"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";

type InviteInfo = { name: string; email: string; roleLabel: string };

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("This invite link is missing its token.");
      return;
    }
    fetch(`/api/auth/invite-info?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error ?? "This invite link is invalid or has expired.");
        setInvite(data);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "This invite link is invalid or has expired."));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Password and confirmation do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to set up your account");
      router.push("/login?accepted=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set up your account");
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Invite Link Problem</h1>
        <p className="card mt-4 text-sm text-red-600 dark:text-red-400">{loadError}</p>
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          Ask whoever invited you to send a new invite, or{" "}
          <Link href="/login" className="underline hover:text-slate-900 dark:hover:text-slate-100">
            sign in
          </Link>{" "}
          if you already have an account.
        </p>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="mx-auto max-w-md">
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading invite...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Set Your Password</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        Welcome, {invite.name}. Your account ({invite.email}) is set up as{" "}
        <span className="font-medium text-slate-700 dark:text-slate-300">{invite.roleLabel}</span>. Choose a password
        to activate it.
      </p>

      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="field">
          <label>Password</label>
          <PasswordInput required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label>Confirm Password</label>
          <PasswordInput
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Setting up..." : "Activate Account"}
        </button>
      </form>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}

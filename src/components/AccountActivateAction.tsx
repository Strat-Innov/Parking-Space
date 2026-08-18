"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";

export default function AccountActivateAction({ id, needsPassword }: { id: string; needsPassword: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function activate(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(needsPassword ? { password } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to activate account");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate account");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => (needsPassword ? setOpen(true) : activate())} className="btn-secondary py-1 text-xs">
        Activate
      </button>
    );
  }

  return (
    <form onSubmit={activate} className="flex items-center gap-2">
      <PasswordInput
        required
        minLength={8}
        placeholder="Set a temp password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-36 text-xs"
      />
      <button type="submit" disabled={loading} className="btn-primary py-1 text-xs">
        {loading ? "..." : "Confirm"}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </form>
  );
}

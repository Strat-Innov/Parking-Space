"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROLE_LABELS, type Role } from "@/lib/types";

export default function Nav({ name, role }: { name: string; role: Role }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          Parking Space
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
            Dashboard
          </Link>
          <Link href="/rate-table" className="text-slate-600 hover:text-slate-900">
            Rate Table
          </Link>
          <span className="text-slate-400">|</span>
          <span className="text-slate-600">
            {name} <span className="text-slate-400">({ROLE_LABELS[role]})</span>
          </span>
          <button onClick={logout} className="btn-secondary py-1.5">
            Log out
          </button>
        </nav>
      </div>
    </header>
  );
}

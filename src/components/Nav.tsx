"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROLE_LABELS, type Role } from "@/lib/types";
import ThemeToggle from "@/components/ThemeToggle";

// Same roles as Rate Table maintenance access (Section 7) — the roles that
// actually touch slot assignment or the requests feeding it.
const PARKING_LOCATION_ROLES: Role[] = ["PARKING_MANAGEMENT", "PREPARED_BY", "VALIDATED_BY"];

export default function Nav({ name, role }: { name: string; role: Role }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/dashboard" className="font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Parking Space
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
            Dashboard
          </Link>
          <Link href="/rate-table" className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
            Rate Table
          </Link>
          {PARKING_LOCATION_ROLES.includes(role) && (
            <Link
              href="/parking-locations"
              className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              Parking Location
            </Link>
          )}
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <ThemeToggle />
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <span className="text-slate-600 dark:text-slate-400">
            {name} <span className="text-slate-400 dark:text-slate-500">({ROLE_LABELS[role]})</span>
          </span>
          <button onClick={logout} className="btn-secondary py-1.5">
            Log out
          </button>
        </nav>
      </div>
    </header>
  );
}

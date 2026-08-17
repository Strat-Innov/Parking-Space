"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ROLE_LABELS, type Role } from "@/lib/types";
import ThemeToggle from "@/components/ThemeToggle";

// Same roles as Rate Table maintenance access (Section 7) — the roles that
// actually touch slot assignment or the requests feeding it.
const PARKING_LOCATION_ROLES: Role[] = ["PARKING_MANAGEMENT", "PREPARED_BY", "VALIDATED_BY"];
const LINK_CLASS = "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100";

export default function Nav({ name, role }: { name: string; role: Role }) {
  const router = useRouter();
  const pathname = usePathname();
  // Same staff accounts work both systems (see login page) — this is just
  // which set of nav links/dashboard is currently showing, not a
  // permission boundary.
  const inAccessSystem = pathname?.startsWith("/access") ?? false;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link
          href={inAccessSystem ? "/access/dashboard" : "/dashboard"}
          className="font-semibold tracking-tight text-slate-900 dark:text-slate-100"
        >
          Parking {inAccessSystem ? "Access" : "Space"}
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {inAccessSystem ? (
            <Link href="/access/dashboard" className={LINK_CLASS}>
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/dashboard" className={LINK_CLASS}>
                Dashboard
              </Link>
              <Link href="/rate-table" className={LINK_CLASS}>
                Rate Table
              </Link>
              {PARKING_LOCATION_ROLES.includes(role) && (
                <Link href="/parking-locations" className={LINK_CLASS}>
                  Parking Location
                </Link>
              )}
            </>
          )}
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <Link href={inAccessSystem ? "/dashboard" : "/access/dashboard"} className={LINK_CLASS}>
            Switch to {inAccessSystem ? "Parking Space" : "Parking Access"}
          </Link>
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

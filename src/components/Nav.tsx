"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type Role } from "@/lib/types";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";

// Same roles as Rate Table maintenance access (Section 7) — the roles that
// actually touch slot assignment or the requests feeding it.
const PARKING_LOCATION_ROLES: Role[] = ["PARKING_MANAGEMENT", "PREPARED_BY", "VALIDATED_BY"];
const LINK_CLASS = "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100";

export default function Nav({ name, role }: { name: string; role: Role }) {
  const pathname = usePathname();
  // Same staff accounts work both systems (see login page) — this is just
  // which set of nav links/dashboard is currently showing, not a
  // permission boundary.
  const inAccessSystem = pathname?.startsWith("/access") ?? false;

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
          <UserMenu name={name} role={role} />
        </nav>
      </div>
    </header>
  );
}

import Link from "next/link";

const ACTIVE = "font-semibold text-slate-900 dark:text-slate-100";
const INACTIVE = "text-slate-500 underline hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100";

// Shown on both public intake forms so a visitor who lands on the wrong one
// (e.g. scanned the wrong QR code) can switch without navigating away.
export default function RequestTypeLinks({ current }: { current: "space" | "access" }) {
  return (
    <div className="mb-4 flex items-center gap-2 text-sm">
      <Link href="/requests/new" className={current === "space" ? ACTIVE : INACTIVE}>
        Parking Space Request
      </Link>
      <span className="text-slate-300 dark:text-slate-700">|</span>
      <Link href="/access/new" className={current === "access" ? ACTIVE : INACTIVE}>
        Parking Access Enrollment
      </Link>
    </div>
  );
}

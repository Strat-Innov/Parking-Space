const COLORS: Record<string, string> = {
  // Status
  Submitted: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "In Preparation": "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  "Pending Approval": "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
  Approved: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300",
  Completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  Cancelled: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  // Approval Stage
  "Prepared By": "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  "Validated By": "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
  "Post-Approval": "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300",
  // Payment / Slot
  "Not Started": "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  Pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  Confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  Unassigned: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  Assigned: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  // Parking Location inventory
  Available: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  "Occupied now": "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  Removed: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
};

export default function StatusBadge({ value }: { value: string }) {
  const cls = COLORS[value] ?? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{value}</span>;
}

const COLORS: Record<string, string> = {
  // Status
  Submitted: "bg-slate-100 text-slate-700",
  "In Preparation": "bg-amber-100 text-amber-800",
  "Pending Approval": "bg-blue-100 text-blue-800",
  Approved: "bg-indigo-100 text-indigo-800",
  Completed: "bg-emerald-100 text-emerald-800",
  Cancelled: "bg-red-100 text-red-700",
  // Approval Stage
  "Prepared By": "bg-amber-100 text-amber-800",
  "Validated By": "bg-blue-100 text-blue-800",
  "Post-Approval": "bg-indigo-100 text-indigo-800",
  // Payment / Slot
  "Not Started": "bg-slate-100 text-slate-600",
  Pending: "bg-amber-100 text-amber-800",
  Confirmed: "bg-emerald-100 text-emerald-800",
  Unassigned: "bg-slate-100 text-slate-600",
  Assigned: "bg-emerald-100 text-emerald-800",
};

export default function StatusBadge({ value }: { value: string }) {
  const cls = COLORS[value] ?? "bg-slate-100 text-slate-700";
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{value}</span>;
}

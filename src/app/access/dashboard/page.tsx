import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { repos } from "@/lib/data";
import StatusBadge from "@/components/StatusBadge";
import { ROLE_LABELS, type Role } from "@/lib/types";
import type { AccessRequestRecord } from "@/lib/data/types";

type Row = AccessRequestRecord & { requester: { name: string } };

// Only Parking Management has anything to do (AWF02/AWF03) — everyone else
// can still view everything, same as Parking Space's dashboard.
function isActionable(role: Role, r: Pick<AccessRequestRecord, "status">) {
  return role === "PARKING_MANAGEMENT" && (r.status === "Submitted" || r.status === "Processed");
}

function RequestsTable({ requests, emptyLabel }: { requests: Row[]; emptyLabel: string }) {
  return (
    <div className="card table-wrap overflow-x-auto p-0">
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Type of Request</th>
            <th>Type of Access</th>
            <th>Status</th>
            <th>Qty</th>
            <th>Date of Request</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requests.length === 0 && (
            <tr>
              <td colSpan={7} className="py-8 text-center text-slate-400 dark:text-slate-500">
                {emptyLabel}
              </td>
            </tr>
          )}
          {requests.map((r) => (
            <tr key={r.id}>
              <td>{r.companyName}</td>
              <td>{r.requestType}</td>
              <td>{r.accessType}</td>
              <td>
                <StatusBadge value={r.status} />
              </td>
              <td>{r.requestedQuantity}</td>
              <td>{new Date(r.dateOfRequest).toLocaleDateString()}</td>
              <td>
                <Link
                  href={`/access/${r.id}`}
                  className="text-sm font-medium text-slate-700 underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AccessDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const role = session.role as Role;

  const requests = await repos.accessRequests.listAllWithRequesterName();

  const actionable = requests.filter((r) => isActionable(role, r));
  const rest = requests.filter((r) => !isActionable(role, r));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Parking Access Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{ROLE_LABELS[role]} queue</p>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight">
          Needs Your Action
          {actionable.length > 0 && (
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white">{actionable.length}</span>
          )}
        </h2>
        <RequestsTable requests={actionable} emptyLabel="Nothing needs your action right now." />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Other Requests</h2>
        <RequestsTable requests={rest} emptyLabel="No other requests." />
      </div>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { ROLE_LABELS, type Role } from "@/lib/types";
import type { ParkingRequest } from "@prisma/client";

type Row = ParkingRequest & { requester: { name: string } };

function isActionable(role: Role, r: Pick<ParkingRequest, "status" | "paymentStatus" | "slotStatus">) {
  switch (role) {
    case "PREPARED_BY":
      // WF02 (prepare/endorse) and WF04 (confirm payment) both land here now.
      return r.status === "In Preparation" || (r.status === "Approved" && r.paymentStatus !== "Confirmed");
    case "VALIDATED_BY":
      return r.status === "Pending Approval";
    case "PARKING_MANAGEMENT":
      return r.status === "Approved" && r.slotStatus !== "Assigned";
    default:
      return false;
  }
}

function RequestsTable({ requests, emptyLabel }: { requests: Row[]; emptyLabel: string }) {
  return (
    <div className="card table-wrap overflow-x-auto p-0">
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Service</th>
            <th>Status</th>
            <th>Approval Stage</th>
            <th>Payment</th>
            <th>Slot</th>
            <th>Required Start</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requests.length === 0 && (
            <tr>
              <td colSpan={8} className="py-8 text-center text-slate-400 dark:text-slate-500">
                {emptyLabel}
              </td>
            </tr>
          )}
          {requests.map((r) => (
            <tr key={r.id}>
              <td>{r.companyName}</td>
              <td>{r.serviceType}</td>
              <td>
                <StatusBadge value={r.status} />
              </td>
              <td>
                <StatusBadge value={r.approvalStage} />
              </td>
              <td>
                <StatusBadge value={r.paymentStatus} />
              </td>
              <td>
                <StatusBadge value={r.slotStatus} />
              </td>
              <td>{new Date(r.requiredStartDate).toLocaleDateString()}</td>
              <td>
                <Link
                  href={`/requests/${r.id}`}
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

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const role = session.role as Role;

  const requests = await prisma.parkingRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: { requester: { select: { name: true } } },
  });

  const actionable = requests.filter((r) => isActionable(role, r));
  const rest = requests.filter((r) => !isActionable(role, r));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
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

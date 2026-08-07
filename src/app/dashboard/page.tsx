import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { ROLE_LABELS, type Role } from "@/lib/types";
import type { ParkingRequest } from "@prisma/client";

function isActionable(role: Role, r: Pick<ParkingRequest, "status" | "paymentStatus" | "slotStatus">) {
  switch (role) {
    case "PREPARED_BY":
      return r.status === "In Preparation";
    case "VALIDATED_BY":
      return r.status === "Pending Approval";
    case "CASHIER":
      return r.status === "Approved" && r.paymentStatus !== "Confirmed";
    case "PARKING_MANAGEMENT":
      return r.status === "Approved" && r.slotStatus !== "Assigned";
    default:
      return false;
  }
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const role = session.role as Role;

  const where = role === "REQUESTER" ? { requesterId: session.sub } : {};
  const requests = await prisma.parkingRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { requester: { select: { name: true } } },
  });

  const sorted = [...requests].sort((a, b) => Number(isActionable(role, b)) - Number(isActionable(role, a)));
  const actionableCount = requests.filter((r) => isActionable(role, r)).length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {ROLE_LABELS[role]} queue
            {role !== "REQUESTER" && actionableCount > 0 && (
              <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white">{actionableCount} need action</span>
            )}
          </p>
        </div>
        {role === "REQUESTER" && (
          <Link href="/requests/new" className="btn-primary">
            New Request
          </Link>
        )}
      </div>

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
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">
                  No requests yet.
                </td>
              </tr>
            )}
            {sorted.map((r) => (
              <tr key={r.id} className={isActionable(role, r) ? "bg-amber-50/50" : ""}>
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
                  <Link href={`/requests/${r.id}`} className="text-sm font-medium text-slate-700 underline hover:text-slate-900">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

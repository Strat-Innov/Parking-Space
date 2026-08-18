import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import RateTableForm from "@/components/RateTableForm";
import DeleteRateEntryAction from "@/components/DeleteRateEntryAction";
import type { Role } from "@/lib/types";

const MAINTAINERS: Role[] = ["PARKING_MANAGEMENT", "PREPARED_BY", "VALIDATED_BY", "DEVELOPER"];

export default async function RateTablePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const entries = await prisma.rateTableEntry.findMany({
    orderBy: [{ serviceType: "asc" }, { effectiveStartDate: "desc" }],
    include: { createdBy: { select: { name: true } } },
  });

  const canMaintain = MAINTAINERS.includes(session.role as Role);
  const isDeveloper = session.role === "DEVELOPER";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rate Table</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Append-only reference list. WF03 snapshots the effective rate onto a request at the moment of approval.
        </p>
      </div>

      {canMaintain && <RateTableForm />}

      <div className="card table-wrap overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>Service Type</th>
              <th>Charging Model</th>
              <th>Rate Amount</th>
              <th>Effective Start</th>
              <th>Added By</th>
              <th>Version ID</th>
              {isDeveloper && <th></th>}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={isDeveloper ? 7 : 6} className="py-8 text-center text-slate-400 dark:text-slate-500">
                  No rate versions configured yet.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.serviceType}</td>
                <td>{e.chargingModel}</td>
                <td>{e.rateAmount.toFixed(2)}</td>
                <td>{new Date(e.effectiveStartDate).toLocaleDateString()}</td>
                <td>{e.createdBy?.name ?? "—"}</td>
                <td className="font-mono text-xs text-slate-400 dark:text-slate-500">{e.id}</td>
                {isDeveloper && (
                  <td>
                    <DeleteRateEntryAction id={e.id} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

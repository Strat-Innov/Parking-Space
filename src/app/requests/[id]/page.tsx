import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import Timeline from "@/components/Timeline";
import RequestActions from "@/components/RequestActions";
import type { Role } from "@/lib/types";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800">{value ?? "—"}</dd>
    </div>
  );
}

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const request = await prisma.parkingRequest.findUnique({
    where: { id },
    include: {
      requester: { select: { name: true, email: true } },
      preparedBy: { select: { name: true } },
      validatedBy: { select: { name: true } },
      rejectedBy: { select: { name: true } },
      cashier: { select: { name: true } },
      assignedBy: { select: { name: true } },
      rateVersion: true,
      events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true, role: true } } } },
    },
  });

  if (!request) notFound();
  if (session.role === "REQUESTER" && request.requesterId !== session.sub) notFound();

  const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString() : "—");
  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString() : "—");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-mono text-slate-400">{request.id}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{request.companyName}</h1>
        <p className="text-sm text-slate-500">Submitted by {request.requester.name}</p>
      </div>

      {/* BR-008: Status and Approval Stage are never merged; Payment/Slot are
          independent tracks (BR-006) — shown as four distinct badges. */}
      <div className="card">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Status</p>
            <StatusBadge value={request.status} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Approval Stage</p>
            <StatusBadge value={request.approvalStage} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Payment Status</p>
            <StatusBadge value={request.paymentStatus} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Slot Status</p>
            <StatusBadge value={request.slotStatus} />
          </div>
        </div>
      </div>

      <RequestActions
        request={{
          id: request.id,
          requesterId: request.requesterId,
          status: request.status,
          paymentStatus: request.paymentStatus,
          slotStatus: request.slotStatus,
        }}
        role={session.role as Role}
        userId={session.sub}
      />

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Request Details</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Email Address" value={request.emailAddress} />
          <Field label="Service Type" value={request.serviceType} />
          <Field label="Preferred Location" value={request.preferredParkingLocation} />
          <Field label="Date of Request" value={fmt(request.dateOfRequest)} />
          <Field label="Required Start Date" value={fmtDate(request.requiredStartDate)} />
          <Field label="End Date" value={fmtDate(request.endDate)} />
          <Field label="Purpose" value={request.purpose} />
          <Field
            label="Computed Total"
            value={
              request.totalHours != null
                ? `${request.totalHours} hour(s)`
                : request.totalDays != null
                ? `${request.totalDays} day(s)`
                : request.totalMonths != null
                ? `${request.totalMonths} month(s)`
                : "—"
            }
          />
        </dl>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Approval</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Approval Decision" value={request.approvalDecision} />
          <Field label="Validated By" value={request.validatedBy?.name} />
          <Field label="Validated Date" value={fmt(request.validatedDate)} />
          <Field label="Rejection Count" value={request.rejectionCount} />
          <Field label="Rejection Reason (latest)" value={request.rejectionReason} />
          <Field label="Rejected By (latest)" value={request.rejectedBy?.name} />
          <Field label="Rejected Date (latest)" value={fmt(request.rejectedDate)} />
        </dl>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Payment Track (WF04)</h2>
          <dl className="space-y-3">
            <Field label="Cashier" value={request.cashier?.name} />
            <Field label="Pay Date" value={fmt(request.payDate)} />
            <Field label="Official Receipt Reference" value={request.officialReceiptReference} />
            <Field
              label="Rate Snapshot"
              value={
                request.rateAmountSnapshot != null
                  ? `${request.rateAmountSnapshot} (v${request.rateVersionId}, snapshotted ${fmt(request.rateSnapshotDate)})`
                  : "Not yet approved — no rate locked in"
              }
            />
            <Field label="Total Payment Due" value={request.totalPaymentDue != null ? request.totalPaymentDue.toFixed(2) : "—"} />
          </dl>
        </div>
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Slot Track (WF05)</h2>
          <dl className="space-y-3">
            <Field label="Assigned Slot" value={request.assignedSlot} />
            <Field label="Slot Assignment Date" value={fmt(request.slotAssignmentDate)} />
            <Field label="Assigned By" value={request.assignedBy?.name} />
          </dl>
        </div>
      </div>

      <Field label="Completed Date" value={fmt(request.completedDate)} />

      <Timeline events={request.events} />
    </div>
  );
}

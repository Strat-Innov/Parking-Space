import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { repos } from "@/lib/data";
import StatusBadge from "@/components/StatusBadge";
import Timeline from "@/components/Timeline";
import AccessProcessForm from "@/components/AccessProcessForm";
import AccessCompleteForm from "@/components/AccessCompleteForm";
import CancelAccessRequestAction from "@/components/CancelAccessRequestAction";
import type { Role } from "@/lib/types";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-800 dark:text-slate-200">{value ?? "—"}</dd>
    </div>
  );
}

export default async function AccessRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const request = await repos.accessRequests.findDetailById(id);

  if (!request) notFound();

  const canProcess = session.role === "PARKING_MANAGEMENT" && request.status === "Submitted";
  const canComplete = session.role === "PARKING_MANAGEMENT" && request.status === "Processed";

  const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString() : "—");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-mono text-slate-400 dark:text-slate-500">{request.id}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{request.companyName}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Submitted by {request.requester.name}</p>
      </div>

      <div className="card">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Status</p>
        <StatusBadge value={request.status} />
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Enrollment Details</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Enrollment Type" value={request.enrollmentType} />
          <Field label="Type of Request" value={request.requestType} />
          {request.requestType === "Transfer" && (
            <Field label="Transfer" value={`To: ${request.transferTo ?? "—"} / From: ${request.transferFrom ?? "—"}`} />
          )}
          <Field label="Full Name" value={request.fullName} />
          <Field label="Email Address" value={request.emailAddress} />
          <Field label="Contact Number" value={request.contactNumber} />
          <Field label="Vehicle Plate Number/Model/Class" value={request.vehiclePlateNumber} />
          <Field label="Property Location" value={request.propertyLocation} />
          <Field label="Date of Request" value={fmt(request.dateOfRequest)} />
          <Field label="No. of Purchase" value={request.requestedQuantity} />
          <Field label="Type of Access" value={request.accessType} />
          <Field label="Requestor's Authorized Approver" value={request.approverName} />
          <Field label="Remarks" value={request.remarks} />
        </dl>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Validation of Document &amp; Access Endorsement</h2>
        {canProcess ? (
          <AccessProcessForm requestId={request.id} defaultQuantity={request.requestedQuantity} />
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Checked/Endorsed By" value={request.processedBy?.name} />
            <Field label="Date" value={fmt(request.processedDate)} />
            <Field label="Qty Purchase" value={request.confirmedQuantity} />
            <Field label="Access Series/Ref." value={request.accessSeriesRef} />
            <Field
              label="Purchased Charge (Php)"
              value={request.purchasedCharge != null ? request.purchasedCharge.toFixed(2) : "—"}
            />
            <Field label="OR No." value={request.officialReceiptRef} />
            <Field label="Remarks" value={request.staffRemarks} />
          </dl>
        )}
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Client Receipt Confirmation</h2>
        {canComplete ? (
          <AccessCompleteForm requestId={request.id} />
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Received By" value={request.receivedByName} />
            <Field label="Confirmed By" value={request.completedBy?.name} />
            <Field label="Date" value={fmt(request.completedDate)} />
          </dl>
        )}
      </div>

      {request.status === "Cancelled" && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Cancelled</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Cancelled By" value={request.cancelledBy?.name} />
            <Field label="Date" value={fmt(request.cancelledDate)} />
          </dl>
        </div>
      )}

      <Timeline events={request.events} />

      <CancelAccessRequestAction requestId={request.id} status={request.status} />
    </div>
  );
}

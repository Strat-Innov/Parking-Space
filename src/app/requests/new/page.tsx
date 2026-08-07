import RequestDetailsForm from "@/components/RequestDetailsForm";

// Public — this is the page a QR code points at. External companies fill
// this out with no account and no login; see /api/requests POST for how an
// anonymous submission still gets a requesterId under the hood.
export default async function NewRequestPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">New Parking Request</h1>
      <p className="mb-6 text-sm text-slate-500">
        Date of Request is set automatically on submission (BR-003) — you can&apos;t back-date or edit it.
      </p>
      <RequestDetailsForm mode="create" />
    </div>
  );
}

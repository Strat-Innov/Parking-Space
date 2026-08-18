import RequestDetailsForm from "@/components/RequestDetailsForm";
import RequestTypeLinks from "@/components/RequestTypeLinks";
import { getSession } from "@/lib/auth";
import { ROLE_LABELS, type Role } from "@/lib/types";

// Public — this is the page a QR code points at. External companies fill
// this out with no account and no login; see /api/requests POST for how an
// anonymous submission still gets a requesterId under the hood.
export default async function NewRequestPage() {
  const session = await getSession();

  return (
    <div className="mx-auto max-w-2xl">
      <RequestTypeLinks current="space" />
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New Parking Request</h1>
      {session ? (
        <div className="card mb-6 border-amber-300 bg-amber-50 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          You&apos;re logged in as {ROLE_LABELS[session.role as Role]} ({session.email}). Staff accounts can&apos;t
          submit requests through this form — log out first, or open this page in a private/incognito window, to
          submit as a guest requestor.
        </div>
      ) : (
        <RequestDetailsForm mode="create" />
      )}
    </div>
  );
}

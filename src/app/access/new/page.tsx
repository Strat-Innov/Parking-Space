import AccessRequestForm from "@/components/AccessRequestForm";
import RequestTypeLinks from "@/components/RequestTypeLinks";
import { getSession } from "@/lib/auth";
import { ROLE_LABELS, type Role } from "@/lib/types";

// Public — same pattern as /requests/new (a QR-code-reachable form, no
// login). See /api/access-requests POST for how an anonymous submission
// still gets a requesterId under the hood.
export default async function NewAccessRequestPage() {
  const session = await getSession();

  return (
    <div className="mx-auto max-w-2xl">
      <RequestTypeLinks current="access" />
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Enrollment for Parking Access</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        RFID Sticker / Card / Metal Tag enrollment. Date of Request is set automatically on submission.
      </p>
      {session ? (
        <div className="card mb-6 border-amber-300 bg-amber-50 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          You&apos;re logged in as {ROLE_LABELS[session.role as Role]} ({session.email}). Staff accounts can&apos;t
          submit requests through this form — log out first, or open this page in a private/incognito window, to
          submit as a guest requestor.
        </div>
      ) : (
        <AccessRequestForm />
      )}
    </div>
  );
}

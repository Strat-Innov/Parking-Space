import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import NewRequestForm from "@/components/NewRequestForm";

export default async function NewRequestPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "REQUESTER") redirect("/dashboard");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">New Parking Request</h1>
      <p className="mb-6 text-sm text-slate-500">
        Date of Request is set automatically on submission (BR-003) — you can&apos;t back-date or edit it.
      </p>
      <NewRequestForm />
    </div>
  );
}

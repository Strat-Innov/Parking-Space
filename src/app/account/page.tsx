import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ChangePasswordForm from "@/components/ChangePasswordForm";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Account</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Signed in as {session.name} ({session.email}).
        </p>
      </div>

      <ChangePasswordForm />
    </div>
  );
}

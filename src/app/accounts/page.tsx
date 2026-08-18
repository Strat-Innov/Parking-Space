import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CreateAccountForm from "@/components/CreateAccountForm";
import { ROLE_LABELS, STAFF_ROLES, type Role } from "@/lib/types";

export default async function AccountsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const accounts = await prisma.user.findMany({
    where: { role: { in: STAFF_ROLES as unknown as string[] } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Staff Accounts</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Any staff member can add a new account for a coworker. New accounts sign in with the email and temporary
          password entered here.
        </p>
      </div>

      <CreateAccountForm />

      <div className="card table-wrap overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-slate-400 dark:text-slate-500">
                  No staff accounts yet.
                </td>
              </tr>
            )}
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.email}</td>
                <td>{ROLE_LABELS[a.role as Role] ?? a.role}</td>
                <td>{new Date(a.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

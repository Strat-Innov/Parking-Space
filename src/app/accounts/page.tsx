import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CreateAccountForm from "@/components/CreateAccountForm";
import InviteStaffForm from "@/components/InviteStaffForm";
import AccountActivateAction from "@/components/AccountActivateAction";
import AccountDeactivateAction from "@/components/AccountDeactivateAction";
import AccountDeleteAction from "@/components/AccountDeleteAction";
import EditRoleAction from "@/components/EditRoleAction";
import { ROLE_LABELS, STAFF_ROLES, type Role } from "@/lib/types";

function accountStatus(a: { active: boolean; emailVerifiedAt: Date | null; hasPassword: boolean }) {
  if (!a.active) return "Disabled";
  if (a.emailVerifiedAt) return "Active";
  if (!a.hasPassword) return "Invited (pending)";
  return "Unconfirmed";
}

export default async function AccountsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const isDeveloper = session.role === "DEVELOPER";

  const accounts = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLES, "DEVELOPER"] as unknown as string[] } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Staff Accounts</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {isDeveloper
            ? "As a Developer, you can add, invite, deactivate/reactivate, edit the role of, or permanently delete (if unused) any staff account."
            : "Account management is handled by a Developer."}
        </p>
      </div>

      {isDeveloper && (
        <>
          <InviteStaffForm />
          <CreateAccountForm allowDeveloperRole={isDeveloper} />
        </>
      )}

      <div className="card table-wrap overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400 dark:text-slate-500">
                  No staff accounts yet.
                </td>
              </tr>
            )}
            {accounts.map((a) => {
              const status = accountStatus(a);
              return (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.email}</td>
                  {(() => {
                    const roles = a.roles.length ? a.roles : [a.role];
                    return (
                      <>
                        <td>{roles.map((r) => ROLE_LABELS[r as Role] ?? r).join(", ")}</td>
                        <td>{status}</td>
                        <td>{new Date(a.createdAt).toLocaleDateString()}</td>
                        <td>
                          <span className="flex flex-wrap items-center gap-2">
                            {status !== "Active" && status !== "Disabled" && (
                              <AccountActivateAction id={a.id} needsPassword={!a.hasPassword} />
                            )}
                            {isDeveloper && (status === "Active" || status === "Disabled") && a.id !== session.sub && (
                              <AccountDeactivateAction id={a.id} active={a.active} />
                            )}
                            {isDeveloper && a.id !== session.sub && <EditRoleAction id={a.id} currentRoles={roles} />}
                            {isDeveloper && a.id !== session.sub && <AccountDeleteAction id={a.id} name={a.name} />}
                          </span>
                        </td>
                      </>
                    );
                  })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

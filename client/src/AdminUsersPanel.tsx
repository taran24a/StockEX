import { AdminUsersResponseSchema, type User } from "@tradewise/shared";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api";

// SYLLABUS: reusable components
// SYLLABUS: Tailwind
export function AdminUsersPanel({ token, role }: { token: string | null; role: User["role"] }) {
  // SYLLABUS: validation
  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiRequest("/api/admin/users", AdminUsersResponseSchema, token ?? undefined),
    enabled: role === "admin" && token !== null
  });

  if (role !== "admin" || token === null) {
    return null;
  }
  const users = usersQuery.data?.users;

  return (
    <section aria-labelledby="admin-users-heading" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-white" id="admin-users-heading">User directory</h2>
        <p className="mt-1 text-xs text-slate-500">Read-only view of the latest 100 registered accounts</p>
      </div>
      {usersQuery.isPending ? <p className="text-sm text-slate-500">Loading users…</p> :
        usersQuery.error instanceof Error ? (
          <p className="rounded-lg border border-rose-900 bg-rose-950/50 p-3 text-sm text-rose-300" role="alert">
            {usersQuery.error.message}
          </p>
        ) : users === undefined ? (
          <p className="rounded-lg border border-rose-900 bg-rose-950/50 p-3 text-sm text-rose-300" role="alert">
            The user list could not be loaded.
          </p>
        ) : users.length === 0 ? <p className="text-sm text-slate-500">No accounts found.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="py-3 pr-4">Account</th><th className="pr-4">Email</th><th className="pr-4">Role</th><th>Joined</th></tr>
              </thead>
              <tbody>
                {users.map((listedUser) => (
                  <tr className="border-t border-slate-800" key={listedUser.id}>
                    <td className="py-3 pr-4 font-medium text-white">{listedUser.displayName}</td>
                    <td className="pr-4 text-slate-300">{listedUser.email}</td>
                    <td className="pr-4 capitalize text-slate-300">{listedUser.role}</td>
                    <td className="whitespace-nowrap text-slate-400">{new Date(listedUser.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

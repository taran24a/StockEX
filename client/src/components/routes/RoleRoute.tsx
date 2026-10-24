import type { ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../auth";
import { Spinner } from "../ui/Spinner";

export function RoleRoute({ children, role }: { children: ReactNode; role: "admin" }) {
  const { user, ready } = useAuth();

  if (!ready) {
    return <div className="grid min-h-screen place-items-center"><Spinner label="Checking permissions" /></div>;
  }
  if (user === null) {
    return <Navigate to="/login" replace />;
  }
  if (user.role !== role) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
        <section aria-labelledby="forbidden-heading" className="max-w-md rounded-2xl border border-rose-900/70 bg-slate-900 p-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">403 · Forbidden</p>
          <h1 className="mt-3 text-2xl font-semibold" id="forbidden-heading">Administrator access required</h1>
          <p className="mt-2 text-sm text-slate-400">Your account does not have permission to view this page.</p>
          <Link className="mt-6 inline-block text-sm font-medium text-cyan-300 hover:text-cyan-200" to="/app/dashboard">
            Return to trading app
          </Link>
        </section>
      </main>
    );
  }
  return children;
}

import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
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
    return <Navigate to="/app" replace />;
  }
  return children;
}

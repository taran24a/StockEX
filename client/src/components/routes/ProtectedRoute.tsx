import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth";
import { Spinner } from "../ui/Spinner";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return <div className="grid min-h-screen place-items-center"><Spinner label="Checking session" /></div>;
  }
  if (user === null) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

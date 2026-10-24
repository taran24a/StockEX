import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { LoginRequest, RegisterRequest } from "@tradewise/shared";
import { AuthForm } from "./AuthForm";
import { AuthProvider, useAuth } from "./auth";

const Dashboard = lazy(() => import("./Dashboard").then((module) => ({ default: module.Dashboard })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 1_000 }
  }
});

function LoginPage() {
  const { user, ready, error, signIn, register } = useAuth();
  const navigate = useNavigate();

  if (!ready) {
    return <p className="p-8 text-center text-slate-400">Checking session…</p>;
  }
  if (user !== null) {
    return <Navigate to="/" replace />;
  }

  async function handleLogin(input: LoginRequest): Promise<void> {
    await signIn(input);
    navigate("/", { replace: true });
  }

  async function handleRegister(input: RegisterRequest): Promise<void> {
    await register(input);
    navigate("/", { replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 py-10 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-7 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-400">Paper trading simulator</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">TradeWise</h1>
        <p className="mb-6 mt-2 text-sm leading-relaxed text-slate-400">
          Practice market decisions with virtual money. No real trades or funds are involved.
        </p>
        {error !== null && <p className="mb-4 text-sm text-rose-400" role="alert">{error}</p>}
        <AuthForm onLogin={handleLogin} onRegister={handleRegister} />
      </section>
    </main>
  );
}

function ProtectedDashboard() {
  const { user, ready } = useAuth();
  if (!ready) {
    return <p className="p-8 text-center text-slate-400">Checking session…</p>;
  }
  if (user === null) {
    return <Navigate to="/login" replace />;
  }
  return (
    <Suspense fallback={<p className="p-8 text-center text-slate-400">Loading workspace…</p>}>
      <Dashboard />
    </Suspense>
  );
}

function ApplicationRoutes() {
  return (
    <Routes>
      <Route element={<ProtectedDashboard />} path="/" />
      <Route element={<LoginPage />} path="/login" />
      <Route element={<Navigate to="/" replace />} path="*" />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ApplicationRoutes />
      </AuthProvider>
    </QueryClientProvider>
  );
}

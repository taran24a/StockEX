import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { LoginRequest, RegisterRequest } from "@tradewise/shared";
import { AuthForm } from "./AuthForm";
import { AuthProvider, useAuth } from "./auth";
import { ProtectedRoute } from "./components/routes/ProtectedRoute";
import { RoleRoute } from "./components/routes/RoleRoute";
import { Card, ErrorBoundary, Spinner } from "./components/ui";
import { LandingPage } from "./LandingPage";

const Dashboard = lazy(() => import("./Dashboard").then((module) => ({ default: module.Dashboard })));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 1_000 }
  }
});

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, ready, error, signIn, register } = useAuth();
  const navigate = useNavigate();

  if (!ready) {
    return <div className="grid min-h-screen place-items-center"><Spinner label="Checking session" /></div>;
  }
  if (user !== null) {
    return <Navigate to={user.role === "admin" ? "/admin" : "/app/dashboard"} replace />;
  }

  async function handleLogin(input: LoginRequest): Promise<void> {
    await signIn(input);
    navigate("/app/dashboard", { replace: true });
  }

  async function handleRegister(input: RegisterRequest): Promise<void> {
    await register(input);
    navigate("/app/dashboard", { replace: true });
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-5 py-10 text-slate-100">
      <Card className="w-full max-w-md p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-400">Paper trading simulator</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">TradeWise</h1>
        <p className="mb-6 mt-2 text-sm leading-relaxed text-slate-400">
          Practice market decisions with virtual money. No real trades or funds are involved.
        </p>
        {error !== null && <p className="mb-4 text-sm text-rose-400" role="alert">{error}</p>}
        <AuthForm initialMode={mode} onLogin={handleLogin} onRegister={handleRegister} showModeToggle={false} />
        <p className="mt-5 text-center text-sm text-slate-400">
          {mode === "login" ? (
            <>New to TradeWise? <Link className="font-medium text-cyan-300 hover:text-cyan-200" to="/register">Create an account</Link></>
          ) : (
            <>Already have an account? <Link className="font-medium text-cyan-300 hover:text-cyan-200" to="/login">Sign in</Link></>
          )}
        </p>
      </Card>
    </main>
  );
}

function AppStub() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><Spinner label="Loading workspace" /></div>}>
      <Dashboard />
    </Suspense>
  );
}

function AdminStub() {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100 sm:p-10">
      <Card className="mx-auto max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">Administrator</p>
        <h1 className="mt-2 text-2xl font-semibold">Admin workspace</h1>
        <p className="mt-2 text-sm text-slate-400">This route is ready for the admin workspace pages.</p>
        <Link className="mt-5 inline-block text-sm font-medium text-cyan-300 hover:text-cyan-200" to="/app/dashboard">
          Go to trading app
        </Link>
      </Card>
    </main>
  );
}

function ApplicationRoutes() {
  return (
    <Routes>
      <Route element={<LandingPage />} path="/" />
      <Route element={<AuthPage mode="login" />} path="/login" />
      <Route element={<AuthPage mode="register" />} path="/register" />
      <Route
        element={<ProtectedRoute><AppStub /></ProtectedRoute>}
        path="/app/*"
      />
      <Route
        element={<RoleRoute role="admin"><AdminStub /></RoleRoute>}
        path="/admin/*"
      />
      <Route element={<Navigate to="/" replace />} path="*" />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ErrorBoundary>
          <ApplicationRoutes />
        </ErrorBoundary>
      </AuthProvider>
    </QueryClientProvider>
  );
}

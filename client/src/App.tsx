import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { LoginRequest, RegisterRequest } from "@tradewise/shared";
import { AuthForm } from "./AuthForm";
import { AuthProvider, useAuth } from "./auth";
import { ProtectedRoute } from "./components/routes/ProtectedRoute";
import { RoleRoute } from "./components/routes/RoleRoute";
import { Card, ErrorBoundary, Spinner } from "./components/ui";
import { LandingPage } from "./LandingPage";
import { WorkspaceLayout } from "./WorkspaceLayout";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 1_000 }
  }
});

function getReturnPath(state: unknown): string {
  const fallback = "/app/dashboard";
  if (state === null || typeof state !== "object" || !("from" in state)) {
    return fallback;
  }

  const from = state.from;
  if (from === null || typeof from !== "object" || !("pathname" in from) || typeof from.pathname !== "string") {
    return fallback;
  }

  const pathname = from.pathname;
  const search = "search" in from && typeof from.search === "string" ? from.search : "";
  const hash = "hash" in from && typeof from.hash === "string" ? from.hash : "";
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    return fallback;
  }

  try {
    const target = new URL(`${pathname}${search}${hash}`, window.location.origin);
    if (target.origin !== window.location.origin) {
      return fallback;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, ready, error, signIn, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = getReturnPath(location.state);
  const storageWarning = error?.startsWith("Your session is active, but it could not be saved") === true;

  if (!ready) {
    return <div className="grid min-h-screen place-items-center"><Spinner label="Checking session" /></div>;
  }
  if (user !== null) {
    return <Navigate to={returnPath} replace />;
  }

  async function handleLogin(input: LoginRequest): Promise<void> {
    await signIn(input);
    navigate(returnPath, { replace: true });
  }

  async function handleRegister(input: RegisterRequest): Promise<void> {
    await register(input);
    navigate("/app/dashboard", { replace: true });
  }

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section aria-label="TradeWise account access" className="auth-main">
          <Link aria-label="TradeWise home" className="auth-brand" to="/">
            <span aria-hidden="true" className="auth-brand-mark">T<span>W</span></span>
            <span>TradeWise</span>
          </Link>
          <div className="auth-form-wrap">
            {error !== null && !storageWarning && <p className="auth-session-error" role="alert">{error}</p>}
            <AuthForm
              key={mode}
              initialMode={mode}
              onLogin={handleLogin}
              onRegister={handleRegister}
              showModeToggle={false}
            />
            <p className="auth-switch">
              {mode === "login" ? (
                <>New to TradeWise? <Link to="/register">Create an account</Link></>
              ) : (
                <>Already have an account? <Link to="/login">Sign in</Link></>
              )}
            </p>
            <p className="auth-legal">Practice with virtual money only. No real trades or funds are involved.</p>
          </div>
        </section>
        <aside aria-label="TradeWise learning promise" className="auth-story">
          <div className="auth-story-top">
            <p className="auth-story-kicker"><span aria-hidden="true" /> A calmer way to learn markets</p>
            <h1>Build your instincts.<br /><span>Not your risk.</span></h1>
            <p className="auth-story-copy">
              Make a move, see what happens, and understand why — all with a portfolio that is yours to practice with.
            </p>
          </div>
          <div aria-hidden="true" className="auth-market-visual">
            <div className="auth-market-grid" />
            <div className="auth-market-line" />
            <span className="auth-market-dot auth-market-dot-one" />
            <span className="auth-market-dot auth-market-dot-two" />
            <span className="auth-market-dot auth-market-dot-three" />
          </div>
          <div className="auth-story-note">
            <span className="auth-note-index">01 / PRACTICE</span>
            <p>Every decision is a lesson.<br />Every lesson is yours to keep.</p>
          </div>
          <span className="auth-story-orbit auth-story-orbit-one" />
          <span className="auth-story-orbit auth-story-orbit-two" />
        </aside>
      </div>
    </main>
  );
}

function AuthStorageWarning() {
  const { error } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [error]);

  if (dismissed || !error?.startsWith("Your session is active, but it could not be saved")) {
    return null;
  }

  return (
    <div className="auth-storage-warning" role="status">
      <span>{error}</span>
      <button aria-label="Dismiss session storage notice" onClick={() => setDismissed(true)} type="button">Dismiss</button>
    </div>
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
    <>
      <AuthStorageWarning />
      <Routes>
        <Route element={<LandingPage />} path="/" />
        <Route element={<AuthPage mode="login" />} path="/login" />
        <Route element={<AuthPage mode="register" />} path="/register" />
        <Route
          element={<ProtectedRoute><WorkspaceLayout /></ProtectedRoute>}
          path="/app/*"
        />
        <Route
          element={<RoleRoute role="admin"><AdminStub /></RoleRoute>}
          path="/admin/*"
        />
        <Route element={<Navigate to="/" replace />} path="*" />
      </Routes>
    </>
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

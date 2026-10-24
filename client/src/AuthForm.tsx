import {
  LoginRequestSchema,
  RegisterRequestSchema,
  type LoginRequest,
  type RegisterRequest
} from "@tradewise/shared";
import { useState, type FormEvent } from "react";

interface AuthFormProps {
  onLogin(input: LoginRequest): Promise<void>;
  onRegister(input: RegisterRequest): Promise<void>;
}

export function AuthForm({ onLogin, onRegister }: AuthFormProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        const parsed = LoginRequestSchema.safeParse({ email, password });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Please check your details");
          return;
        }
        await onLogin(parsed.data);
      } else {
        const parsed = RegisterRequestSchema.safeParse({ email, displayName, password });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Please check your details");
          return;
        }
        await onRegister(parsed.data);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleMode(): void {
    setMode((current) => current === "login" ? "register" : "login");
    setError(null);
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {mode === "register" && (
        <label className="block text-sm text-slate-300">
          Display name
          <input
            autoComplete="name"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
            onChange={(event) => setDisplayName(event.target.value)}
            value={displayName}
          />
        </label>
      )}
      <label className="block text-sm text-slate-300">
        Email
        <input
          autoComplete="email"
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          value={email}
        />
      </label>
      <label className="block text-sm text-slate-300">
        Password
        <input
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          value={password}
        />
      </label>
      {mode === "register" && (
        <p className="text-xs text-slate-500">Use at least 12 characters for your password.</p>
      )}
      {error !== null && <p className="text-sm text-rose-400" role="alert">{error}</p>}
      <button
        className="w-full rounded-lg bg-emerald-400 px-4 py-2.5 font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-50"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
      <button
        className="w-full text-sm text-slate-400 hover:text-white"
        onClick={toggleMode}
        type="button"
      >
        {mode === "login" ? "New to TradeWise? Create an account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}

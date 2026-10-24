import {
  LoginRequestSchema,
  RegisterRequestSchema,
  type LoginRequest,
  type RegisterRequest
} from "@tradewise/shared";
import { useState, type FormEvent } from "react";
import { Button, Input } from "./components/ui";

interface AuthFormProps {
  onLogin(input: LoginRequest): Promise<void>;
  onRegister(input: RegisterRequest): Promise<void>;
  initialMode?: "login" | "register";
  showModeToggle?: boolean;
}

export function AuthForm({
  onLogin,
  onRegister,
  initialMode = "login",
  showModeToggle = true
}: AuthFormProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
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
        <Input
          autoComplete="name"
          label="Display name"
          onChange={(event) => setDisplayName(event.target.value)}
          value={displayName}
        />
      )}
      <Input
        autoComplete="email"
        label="Email"
        onChange={(event) => setEmail(event.target.value)}
        type="email"
        value={email}
      />
      <Input
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        label="Password"
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        value={password}
      />
      {mode === "register" && (
        <p className="text-xs text-slate-500">Use at least 12 characters for your password.</p>
      )}
      {error !== null && <p className="text-sm text-rose-400" role="alert">{error}</p>}
      <Button
        className="w-full"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
      </Button>
      {showModeToggle && (
        <Button className="w-full" onClick={toggleMode} variant="ghost">
          {mode === "login" ? "New to TradeWise? Create an account" : "Already have an account? Sign in"}
        </Button>
      )}
    </form>
  );
}

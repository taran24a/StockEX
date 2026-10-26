import {
  LoginRequestSchema,
  RegisterRequestSchema,
  type LoginRequest,
  type RegisterRequest
} from "@tradewise/shared";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Input } from "./components/ui";

interface AuthFormProps {
  onLogin(input: LoginRequest): Promise<void>;
  onRegister(input: RegisterRequest): Promise<void>;
  onGoogleSignIn(credential: string): Promise<void>;
  initialMode?: "login" | "register";
  showModeToggle?: boolean;
}

interface GoogleCredentialResponse { credential: string }
interface GoogleIdentity {
  initialize(options: { client_id: string; callback(response: GoogleCredentialResponse): void }): void;
  renderButton(element: HTMLElement, options: { theme: string; size: string; shape: string; width: number; text: string }): void;
}
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } } } }

function GoogleSignInButton({ onCredential, onError }: { onCredential(credential: string): Promise<void>; onError(error: string): void }) {
  const container = useRef<HTMLDivElement>(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
  useEffect(() => {
    if (!clientId || container.current === null) return;
    let active = true;
    const render = () => {
      if (!active || container.current === null || !window.google) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (result) => {
        void onCredential(result.credential).catch((error: unknown) => onError(error instanceof Error ? error.message : "Google sign-in failed"));
      }});
      window.google.accounts.id.renderButton(container.current, { theme: "outline", size: "large", shape: "pill", width: Math.max(250, container.current.clientWidth), text: "continue_with" });
    };
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (window.google) render();
    else if (existingScript) existingScript.addEventListener("load", render, { once: true });
    else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = render;
      script.onerror = () => onError("Google sign-in could not load. Check your internet connection.");
      document.head.appendChild(script);
    }
    return () => { active = false; };
  }, [clientId, onCredential, onError]);
  return clientId
    ? <div aria-label="Sign in with Google" className="auth-google-button" ref={container} />
    : <Button className="auth-google-unconfigured" disabled type="button" variant="secondary">Google sign-in · setup required</Button>;
}

type FieldErrors = Partial<Record<"email" | "displayName" | "password", string>>;

function getFieldErrors(issues: Array<{ path: PropertyKey[]; message: string }>): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if ((field === "email" || field === "displayName" || field === "password") && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

function passwordStrength(password: string): { label: string; value: number; width: string } {
  if (password.length === 0) {
    return { label: "Start typing", value: 0, width: "0%" };
  }
  if (Array.from(password).length < 12) {
    return { label: "Weak", value: 1, width: "33.33%" };
  }
  if (Array.from(password).length < 16) {
    return { label: "Fair", value: 2, width: "66.66%" };
  }
  return { label: "Strong", value: 3, width: "100%" };
}

export function AuthForm({
  onLogin,
  onRegister,
  onGoogleSignIn,
  initialMode = "login",
  showModeToggle = true
}: AuthFormProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    if (submitting) {
      return;
    }

    try {
      if (mode === "login") {
        const parsed = LoginRequestSchema.safeParse({ email, password });
        if (!parsed.success) {
          setFieldErrors(getFieldErrors(parsed.error.issues));
          return;
        }
        setSubmitting(true);
        await onLogin(parsed.data);
      } else {
        const parsed = RegisterRequestSchema.safeParse({ email, displayName, password });
        if (!parsed.success) {
          setFieldErrors(getFieldErrors(parsed.error.issues));
          return;
        }
        setSubmitting(true);
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
    setFieldErrors({});
  }

  function fillDemoAccount(): void {
    setEmail("demo@tradewise.dev");
    setPassword("Demo@1234");
    setFieldErrors({});
    setError(null);
  }

  const strength = passwordStrength(password);
  const handleGoogleCredential = useCallback(async (credential: string): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try { await onGoogleSignIn(credential); }
    finally { setSubmitting(false); }
  }, [onGoogleSignIn]);
  const handleGoogleError = useCallback((message: string): void => { setError(message); }, []);

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      <header className="auth-form-heading">
        <p className="auth-eyebrow">{mode === "login" ? "Welcome back" : "Your practice account"}</p>
        <h2>{mode === "login" ? "Sign in to TradeWise" : "Create your account"}</h2>
        <p>{mode === "login"
          ? "Pick up where your learning left off."
          : "Start building your market confidence in a safe space."}</p>
      </header>
      {mode === "register" && (
        <Input
          autoComplete="name"
          error={fieldErrors.displayName}
          id="auth-display-name"
          label="Display name"
          name="displayName"
          onChange={(event) => {
            setDisplayName(event.target.value);
            setFieldErrors((current) => ({ ...current, displayName: undefined }));
          }}
          required
          value={displayName}
        />
      )}
      <Input
        autoComplete="email"
        error={fieldErrors.email}
        id="auth-email"
        label="Email"
        name="email"
        onChange={(event) => {
          setEmail(event.target.value);
          setFieldErrors((current) => ({ ...current, email: undefined }));
        }}
        required
        type="email"
        value={email}
      />
      <div className="auth-password-field">
        <Input
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          error={fieldErrors.password}
          id="auth-password"
          label="Password"
          name="password"
          onChange={(event) => {
            setPassword(event.target.value);
            setFieldErrors((current) => ({ ...current, password: undefined }));
          }}
          required
          type={passwordVisible ? "text" : "password"}
          value={password}
        />
        <Button
          aria-label={passwordVisible ? "Hide password" : "Show password"}
          aria-pressed={passwordVisible}
          className="auth-password-toggle"
          onClick={() => setPasswordVisible((visible) => !visible)}
          type="button"
          variant="ghost"
        >
          {passwordVisible ? "Hide" : "Show"}
        </Button>
      </div>
      {mode === "register" && (
        <div className="auth-strength" aria-live="polite">
          <div className="auth-strength-copy">
            <span>Password strength</span>
            <span className={`auth-strength-label auth-strength-${strength.value}`}>{strength.label}</span>
          </div>
          <div
            aria-label="Password strength"
            aria-valuemax={3}
            aria-valuemin={0}
            aria-valuenow={strength.value}
            className="auth-strength-track"
            role="progressbar"
          >
            <span
              className={`auth-strength-fill auth-strength-fill-${strength.value}`}
              style={{ width: strength.width }}
            />
          </div>
          <p className="auth-form-hint">
            Use at least 12 characters. Passwords are limited to 72 UTF-8 bytes.
          </p>
        </div>
      )}
      {error !== null && <p className="auth-form-error" role="alert">{error}</p>}
      {mode === "login" && (
        <Button
          className="auth-demo-button"
          onClick={fillDemoAccount}
          type="button"
          variant="secondary"
        >
          Try demo account
        </Button>
      )}
      {submitting && <p className="auth-submitting" role="status">Securely checking your details…</p>}
      <div className="auth-divider"><span>or</span></div>
      <GoogleSignInButton onCredential={handleGoogleCredential} onError={handleGoogleError} />
      <Button
        className="auth-submit"
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

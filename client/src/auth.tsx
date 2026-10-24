import {
  AvatarResponseSchema,
  AuthResponseSchema,
  LoginRequestSchema,
  ProfileResponseSchema,
  RegisterRequestSchema,
  type LoginRequest,
  type RegisterRequest,
  type User
} from "@tradewise/shared";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClientError, apiRequest } from "./api";

interface AuthContextValue {
  token: string | null;
  user: User | null;
  avatarUrl: string | null;
  ready: boolean;
  error: string | null;
  signIn(input: LoginRequest): Promise<void>;
  register(input: RegisterRequest): Promise<void>;
  uploadAvatar(file: File): Promise<void>;
  signOut(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_TOKEN_KEY = "tradewise.session-token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(SESSION_TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === null) {
      setUser(null);
      setError(null);
      setReady(true);
      return;
    }

    let active = true;
    setReady(false);
    void apiRequest("/api/auth/me", ProfileResponseSchema, token)
      .then((profile) => {
        if (active) {
          setUser(profile.user);
          setAvatarUrl(profile.avatarUrl);
          setError(null);
        }
      })
      .catch((requestError: unknown) => {
        if (!active) {
          return;
        }
        if (requestError instanceof ApiClientError && requestError.status === 401) {
          sessionStorage.removeItem(SESSION_TOKEN_KEY);
          setToken(null);
          setUser(null);
          setAvatarUrl(null);
          setError(null);
        } else {
          setError(requestError instanceof Error ? requestError.message : "Unable to validate the saved session");
        }
      })
      .finally(() => {
        if (active) {
          setReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, [token]);

  async function establishSession(path: string, input: LoginRequest | RegisterRequest): Promise<void> {
    const schema = path.endsWith("register") ? RegisterRequestSchema : LoginRequestSchema;
    const request = schema.parse(input);
    const session = await apiRequest(path, AuthResponseSchema, undefined, {
      method: "POST",
      body: JSON.stringify(request)
    });
    sessionStorage.setItem(SESSION_TOKEN_KEY, session.token);
    setToken(session.token);
    setUser(session.user);
    setAvatarUrl(null);
    setError(null);
    setReady(true);
  }

  function signOut(): void {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    setToken(null);
    setUser(null);
    setAvatarUrl(null);
    setError(null);
    setReady(true);
  }

  async function uploadAvatar(file: File): Promise<void> {
    if (token === null) {
      throw new Error("Sign in before uploading an avatar");
    }
    const form = new FormData();
    form.set("avatar", file);
    const result = await apiRequest("/api/auth/me/avatar", AvatarResponseSchema, token, {
      method: "POST",
      body: form
    });
    setAvatarUrl(result.avatarUrl);
  }

  const value = useMemo<AuthContextValue>(() => ({
    token,
    user,
    avatarUrl,
    ready,
    error,
    signIn: (input) => establishSession("/api/auth/login", input),
    register: (input) => establishSession("/api/auth/register", input),
    uploadAvatar,
    signOut
  }), [token, user, avatarUrl, ready, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

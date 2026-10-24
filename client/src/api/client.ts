import { ErrorResponseSchema } from "@tradewise/shared";
import type { z } from "zod";

export const SESSION_TOKEN_KEY = "tradewise.session-token";
export const AUTH_EXPIRED_EVENT = "tradewise:auth-expired";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "";

export interface ApiClientOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | null;
  token?: string | null;
  authenticated?: boolean;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function currentToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearCurrentToken(): void {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // AuthProvider also clears its in-memory token when it receives the event.
  }
}

function normalizeApiError(payload: unknown, status: number): ApiClientError {
  const parsed = ErrorResponseSchema.safeParse(payload);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new ApiClientError(message, status, code, details);
  }
  return new ApiClientError(
    status >= 500 ? "The server could not complete the request" : "The request was rejected",
    status,
    "HTTP_ERROR"
  );
}

export async function apiRequest<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  options: ApiClientOptions = {}
): Promise<z.infer<Schema>> {
  const { token, authenticated = true, headers: requestHeaders, body, ...requestOptions } = options;
  const headers = new Headers(requestHeaders);
  headers.set("Accept", "application/json");

  const accessToken = authenticated ? token ?? currentToken() : null;
  if (accessToken !== null) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (
    body !== undefined &&
    body !== null &&
    !(typeof FormData !== "undefined" && body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, { ...requestOptions, headers, body });
  } catch (error) {
    throw new ApiClientError(
      error instanceof Error ? error.message : "The API could not be reached",
      0,
      "NETWORK_ERROR"
    );
  }

  if (response.status === 401) {
    if (accessToken !== null && typeof window !== "undefined") {
      clearCurrentToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new ApiClientError("Your session has expired. Please sign in again.", 401, "UNAUTHORIZED");
  }

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiClientError("The server returned an invalid error response", response.status, "INVALID_ERROR_RESPONSE");
    }
    throw normalizeApiError(payload, response.status);
  }

  if (response.status === 204) {
    return undefined as z.infer<Schema>;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError("The server returned an invalid response", response.status, "INVALID_RESPONSE");
  }
  return schema.parse(payload);
}

export const apiClient = {
  request: apiRequest
};

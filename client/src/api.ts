import { ErrorResponseSchema } from "@tradewise/shared";
import { z } from "zod";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiRequest<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  token?: string,
  init: RequestInit = {}
): Promise<z.infer<Schema>> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (token !== undefined) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError("The server returned an invalid response", response.status);
  }
  if (!response.ok) {
    const parsedError = ErrorResponseSchema.safeParse(payload);
    throw new ApiClientError(
      parsedError.success ? parsedError.data.error.message : "The request failed",
      response.status
    );
  }
  return schema.parse(payload);
}

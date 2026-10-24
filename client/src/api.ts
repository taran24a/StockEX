import type { z } from "zod";
import {
  apiRequest as request,
  type ApiClientOptions
} from "./api/client";

export { ApiClientError } from "./api/client";

export async function apiRequest<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  token?: string,
  init: RequestInit = {}
): Promise<z.infer<Schema>> {
  const options: ApiClientOptions = {
    ...init,
    authenticated: token !== undefined,
    ...(token === undefined ? {} : { token })
  };
  return request(path, schema, options);
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiRequest, AUTH_EXPIRED_EVENT, SESSION_TOKEN_KEY } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("typed API client", () => {
  it("sends bearer authentication and validates the success payload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiRequest("/api/example", z.object({ ok: z.boolean() }), {
      token: "signed-token",
      method: "GET"
    });

    expect(result).toEqual({ ok: true });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer signed-token");
  });

  it("normalizes shared API errors", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "ORDER_REJECTED", message: "Risk limit exceeded" } }), {
        status: 422,
        headers: { "Content-Type": "application/json" }
      })
    ));

    await expect(apiRequest("/api/orders", z.object({}), { authenticated: false })).rejects.toMatchObject({
      name: "ApiClientError",
      code: "ORDER_REJECTED",
      status: 422,
      message: "Risk limit exceeded"
    });
  });

  it("clears an expired session and notifies auth context", async () => {
    const token = "expired-token";
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Expired" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      })
    ));
    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);

    await expect(apiRequest("/api/private", z.object({}), { token })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401
    });

    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  });
});

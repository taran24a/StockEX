import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminUsersPanel } from "./AdminUsersPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel(role: "user" | "admin", token: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminUsersPanel role={role} token={token} />
    </QueryClientProvider>
  );
}

describe("AdminUsersPanel", () => {
  it("does not request or expose the user directory to a regular account", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderPanel("user", "user-token");

    expect(container.childElementCount).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads the validated admin user list for an administrator", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      users: [{
        id: "9e6e50fa-e53b-469b-a0f9-dc6cd91f8c01",
        email: "trader@example.com",
        displayName: "Example Trader",
        role: "user",
        createdAt: "2026-10-20T10:30:00.000Z"
      }],
      pagination: { limit: 100, offset: 0, total: 1 }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    renderPanel("admin", "admin-token");

    expect(await screen.findByRole("heading", { name: "User directory" })).toBeTruthy();
    expect(await screen.findByText("Example Trader")).toBeTruthy();
    expect(screen.getByText("trader@example.com")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users?limit=100",
      expect.objectContaining({ headers: expect.any(Headers) })
    ));
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toMatch(/^Bearer /);
  });
});

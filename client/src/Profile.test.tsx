import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProfilePage } from "./Profile";

const { apiRequestMock, useAuthMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  useAuthMock: vi.fn()
}));

vi.mock("./api", () => ({ apiRequest: apiRequestMock }));
vi.mock("./auth", () => ({ useAuth: useAuthMock }));

const user = {
  id: "8af8401d-00c7-49f0-aeae-914c82dbdd72",
  email: "trader@example.com",
  displayName: "Trader",
  role: "user"
};
const profile = {
  user,
  avatarUrl: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  resetCooldownHours: 24,
  lastResetAt: null,
  nextResetAt: null
};

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><ProfilePage /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  useAuthMock.mockReturnValue({
    token: "signed-token",
    user,
    avatarUrl: null,
    uploadAvatar: vi.fn().mockResolvedValue(undefined),
    updateUser: vi.fn()
  });
  apiRequestMock.mockImplementation((path: string, _schema: unknown, _token: string | undefined, init?: RequestInit) => {
    if (path === "/api/v1/users/me" && init?.method === "PATCH") return Promise.resolve({ ...user, displayName: "New Trader" });
    if (path === "/api/v1/users/me") return Promise.resolve(profile);
    if (path === "/api/v1/users/me/reset") return Promise.resolve({
      cashBalancePaise: 100_000_000,
      cancelledOrders: 1,
      clearedPositions: 2,
      nextResetAt: "2026-10-26T11:00:00.000Z"
    });
    if (path === "/api/admin/settings/virtual-account-reset-cooldown") {
      return Promise.resolve({ cooldownHours: 24, updatedAt: "2026-10-25T10:00:00.000Z" });
    }
    return Promise.reject(new Error(`Unexpected API request: ${path}`));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("profile workspace", () => {
  it("shows account role and creation date and saves a display name", async () => {
    const updateUser = vi.fn();
    useAuthMock.mockReturnValue({
      token: "signed-token",
      user,
      avatarUrl: null,
      uploadAvatar: vi.fn(),
      updateUser
    });
    renderProfile();
    expect(await screen.findByText("trader@example.com")).toBeTruthy();
    expect(screen.getByText("Member since")).toBeTruthy();
    expect(screen.getByText("user")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "New Trader" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ ...user, displayName: "New Trader" }));
  });

  it("validates avatar type and size before upload", async () => {
    const uploadAvatar = vi.fn();
    useAuthMock.mockReturnValue({ token: "signed-token", user, avatarUrl: null, uploadAvatar, updateUser: vi.fn() });
    renderProfile();
    const input = screen.getByLabelText("Choose avatar image") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["not an image"], "avatar.gif", { type: "image/gif" })] } });

    expect((await screen.findByRole("alert")).textContent).toContain("Choose a JPEG, PNG, or WebP image no larger than 2 MB.");
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it("requires matching password confirmation and sends the authenticated password request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    renderProfile();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "CurrentPassword123" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "NewPassword12345" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "DoesNotMatch123" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("alert").textContent).toContain("New password and confirmation do not match.");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "NewPassword12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/me/password", expect.objectContaining({
      method: "PATCH",
      headers: expect.objectContaining({ Authorization: "Bearer signed-token" }),
      body: JSON.stringify({ currentPassword: "CurrentPassword123", newPassword: "NewPassword12345" })
    })));
    expect(await screen.findByText("Password changed successfully.")).toBeTruthy();
  });

  it("requires typed and browser confirmation before resetting the virtual account", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderProfile();
    await screen.findByText("Reset available · 24-hour cooldown");
    fireEvent.change(screen.getByLabelText("Type RESET to confirm"), { target: { value: "RESET" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset virtual account" }));

    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/v1/users/me/reset",
      expect.anything(),
      "signed-token",
      { method: "POST", body: JSON.stringify({ confirm: true }) }
    ));
    expect(await screen.findByText(/1 open orders cancelled, 2 positions cleared/)).toBeTruthy();
  });

  it("offers the reset cooldown editor only to admin users", async () => {
    useAuthMock.mockReturnValue({
      token: "signed-token",
      user: { ...user, role: "admin" },
      avatarUrl: null,
      uploadAvatar: vi.fn(),
      updateUser: vi.fn()
    });
    renderProfile();
    expect(await screen.findByLabelText("Reset cooldown (hours)")).toBeTruthy();
  });
});

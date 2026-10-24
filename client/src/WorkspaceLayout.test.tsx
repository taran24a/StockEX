import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WorkspaceLayout } from "./WorkspaceLayout";

const { useAuthMock, signOutMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  signOutMock: vi.fn()
}));
vi.mock("./auth", () => ({ useAuth: useAuthMock }));
vi.mock("./hooks/useQuotesSocket", () => ({
  useQuotesSocket: () => ({ status: "disconnected", recentOrderEvents: [], error: null })
}));

const user = {
  id: "8af8401d-00c7-49f0-aeae-914c82dbdd72",
  email: "learner@example.com",
  displayName: "Learner",
  role: "user"
};

function renderWorkspace(path = "/app/orders") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<WorkspaceLayout />} path="/app/*" />
          <Route element={<p>Protected admin route</p>} path="/admin/*" />
          <Route element={<p>Sign in route</p>} path="/login" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  signOutMock.mockReset();
  useAuthMock.mockReturnValue({
    token: null,
    user,
    avatarUrl: null,
    signOut: signOutMock,
    uploadAvatar: vi.fn()
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("authenticated workspace shell", () => {
  it("supports keyboard-operable collapsed and expanded desktop navigation", () => {
    renderWorkspace();
    const sidebar = screen.getByRole("complementary", { name: "Workspace sidebar" });
    expect(sidebar.className).not.toContain("is-collapsed");

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(sidebar.className).toContain("is-collapsed");
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(sidebar.className).not.toContain("is-collapsed");
    expect(screen.getByRole("navigation", { name: "Workspace navigation" })).toBeTruthy();
  });

  it("opens the mobile navigation drawer and closes it after selecting a route", async () => {
    renderWorkspace();
    const sidebar = screen.getByRole("complementary", { name: "Workspace sidebar" });
    const openButton = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(openButton);
    expect(sidebar.className).toContain("is-mobile-open");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Dashboard" }));
    fireEvent.click(screen.getByRole("link", { name: "Profile" }));

    expect(await screen.findByRole("heading", { name: "Profile", level: 2 })).toBeTruthy();
    expect(sidebar.className).not.toContain("is-mobile-open");
    expect(document.activeElement).toBe(openButton);
    fireEvent.click(openButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(sidebar.className).not.toContain("is-mobile-open");
    expect(document.activeElement).toBe(openButton);
  });

  it("provides a skip link and focusable main content", () => {
    renderWorkspace("/app/dashboard");
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip.getAttribute("href")).toBe("#main-content");
    const main = screen.getByRole("main");
    expect(main.getAttribute("tabindex")).toBe("-1");
  });

  it("shows the admin navigation item only to administrator users", () => {
    renderWorkspace();
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    cleanup();

    useAuthMock.mockReturnValue({
      token: null,
      user: { ...user, role: "admin" },
      avatarUrl: null,
      signOut: signOutMock,
      uploadAvatar: vi.fn()
    });
    renderWorkspace("/app/orders");
    expect(screen.getByRole("link", { name: "Admin" })).toBeTruthy();
  });

  it("uses the auth sign-out action from the user menu", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "User menu for Learner" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(signOutMock).toHaveBeenCalledOnce();
  });
});

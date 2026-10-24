import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import App, { queryClient } from "./App";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn()
}));

vi.mock("./api", () => ({
  apiRequest: apiRequestMock,
  ApiClientError: class ApiClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
}));

vi.mock("./Dashboard", () => ({
  Dashboard: () => {
    const location = useLocation();
    return <div>{`${location.pathname}${location.search}${location.hash}`}</div>;
  }
}));
vi.mock("./DashboardOverview", () => ({
  DashboardOverview: () => {
    const location = useLocation();
    return <div>{`${location.pathname}${location.search}${location.hash}`}</div>;
  },
  ProfileStub: () => <div>Profile route</div>,
  WorkspaceStub: () => {
    const location = useLocation();
    return <div>{`${location.pathname}${location.search}${location.hash}`}</div>;
  }
}));
vi.mock("./hooks/useQuotesSocket", () => ({
  useQuotesSocket: () => ({ status: "disconnected", recentOrderEvents: [], error: null })
}));

const user = {
  id: "8af8401d-00c7-49f0-aeae-914c82dbdd72",
  email: "trader@example.com",
  displayName: "Trader",
  role: "user"
};

function renderAt(initialEntry: string | { pathname: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  queryClient.clear();
  sessionStorage.clear();
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation((path: string) => Promise.resolve(
    path === "/api/auth/login"
      ? { token: "session-token", expiresAt: "2027-10-25T00:00:00.000Z", user }
      : path === "/api/v1/portfolio"
        ? { totalEquityPaise: 0 }
        : path.startsWith("/api/risk/alerts")
          ? { alerts: [] }
          : { user, avatarUrl: null }
  ));
});

async function submitLogin(): Promise<void> {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "practice-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("authentication route redirects", () => {
  it("returns to the protected pathname, search, and hash after login", async () => {
    renderAt("/app/portfolio?view=orders#open");
    await submitLogin();

    expect(await screen.findByText("/app/portfolio?view=orders#open")).toBeTruthy();
  });

  it("uses the dashboard as the default successful login destination", async () => {
    renderAt("/login");
    await submitLogin();

    expect(await screen.findByText("/app/dashboard")).toBeTruthy();
  });

  it("keeps the successful in-memory login and explains when session persistence is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage is disabled");
    });
    renderAt("/login");
    await submitLogin();

    expect(await screen.findByText("/app/dashboard")).toBeTruthy();
    expect((await screen.findByRole("status")).textContent).toMatch(/could not be saved/i);
  });

  it("rejects an external return location and uses the dashboard fallback", async () => {
    renderAt({
      pathname: "/login",
      state: { from: { pathname: "//outside.example/path", search: "", hash: "" } }
    });
    await submitLogin();

    expect(await screen.findByText("/app/dashboard")).toBeTruthy();
  });
});

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App, { queryClient } from "./App";

const { apiRequestMock, useAuthMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  useAuthMock: vi.fn()
}));

vi.mock("./api", () => ({ apiRequest: apiRequestMock }));
vi.mock("./auth", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: useAuthMock
}));
vi.mock("./Markets", () => ({
  MarketsPage: () => <div>Markets route is intact</div>,
  MarketDetailPage: () => <div>Market detail route is intact</div>
}));
vi.mock("./DashboardOverview", () => ({
  DashboardOverview: () => <div>Dashboard route is intact</div>,
  ProfileStub: () => <div>Profile route</div>,
  WorkspaceStub: () => <div>Workspace route</div>
}));
vi.mock("./hooks/useQuotesSocket", () => ({
  useQuotesSocket: () => ({ status: "disconnected", recentOrderEvents: [], error: null })
}));
vi.mock("./LivePriceChart", () => ({
  LivePriceChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />
}));

const quote = {
  symbol: "ALFA",
  name: "Alfa Compute Systems",
  pricePaise: 12_500_000,
  changePaise: 12_500,
  updatedAt: "2026-10-24T12:00:00.000Z"
};

function renderAt(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  queryClient.clear();
  apiRequestMock.mockReset();
  useAuthMock.mockReturnValue({
    token: null,
    user: null,
    ready: true,
    error: null,
    signIn: vi.fn(),
    register: vi.fn()
  });
  apiRequestMock.mockImplementation(() => Promise.resolve({ quotes: [quote] }));
});

describe("public landing route", () => {
  it("shows the landing content and separates illustrative preview from the app market feed", async () => {
    renderAt();

    expect(screen.getByRole("heading", { name: "Trade smarter. See the market differently." })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    expect(document.querySelectorAll(".landing-logo .tradewise-logo-icon")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Questions, answered." })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Build your market instincts/i })).toBeTruthy();
    expect(screen.getByRole("group", { name: "TradeWise learning trace" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Observe" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Check" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reflect" })).toBeTruthy();
    expect(screen.getByText("Simulated trading with virtual money. Not financial advice.")).toBeTruthy();
    expect((await screen.findAllByText("ALFA")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("₹1,25,000.00")).length).toBeGreaterThan(0);
    expect(screen.getByRole("complementary", { name: "Illustrative workspace preview, not account data" })).toBeTruthy();
    expect(screen.getByText("Example view · not account data")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Already have an account? Sign in" }).getAttribute("href")).toBe("/login");
    expect(screen.getAllByRole("link", { name: "Start practicing" })[0]!.getAttribute("href")).toBe("/register");
    expect(document.querySelector(".landing-ticker-change.is-up")).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith("/api/quotes", expect.anything());
    expect(apiRequestMock).not.toHaveBeenCalledWith(expect.stringContaining("/candles"), expect.anything());
  });

  it("routes signed-out primary calls to registration", async () => {
    renderAt();
    fireEvent.click(screen.getAllByRole("link", { name: "Start practicing" })[0]!);

    expect(await screen.findByLabelText("Display name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
  });

  it("routes the final landing call to action to registration", async () => {
    renderAt();
    const finalCta = document.querySelector(".landing-final-cta .landing-primary-cta");
    expect(finalCta).toBeTruthy();
    fireEvent.click(finalCta!);

    expect(await screen.findByLabelText("Display name")).toBeTruthy();
  });

  it("routes a signed-in call to the protected dashboard", async () => {
    useAuthMock.mockReturnValue({
      token: null,
      user: { id: "1", email: "learner@example.com", displayName: "Learner", role: "user" },
      ready: true,
      error: null,
      signIn: vi.fn(),
      register: vi.fn()
    });

    renderAt();
    expect(screen.getByRole("link", { name: "Explore markets" }).getAttribute("href")).toBe("/app/markets");
    fireEvent.click(screen.getAllByRole("link", { name: "Go to your dashboard" })[0]!);

    expect(await screen.findByText("Dashboard route is intact")).toBeTruthy();
  });

  it("keeps the explicit dashboard route protected and available", async () => {
    useAuthMock.mockReturnValue({
      token: null,
      user: { id: "1", email: "learner@example.com", displayName: "Learner", role: "user" },
      ready: true,
      error: null,
      signIn: vi.fn(),
      register: vi.fn()
    });

    renderAt("/app/dashboard");
    await waitFor(() => expect(screen.getByText("Dashboard route is intact")).toBeTruthy());
  });

  it("opens the protected searchable markets route", async () => {
    useAuthMock.mockReturnValue({
      token: null,
      user: { id: "1", email: "learner@example.com", displayName: "Learner", role: "user" },
      ready: true,
      error: null,
      signIn: vi.fn(),
      register: vi.fn()
    });

    renderAt("/app/markets");
    expect(await screen.findByText("Markets route is intact")).toBeTruthy();
  });

  it("opens a protected instrument detail route", async () => {
    useAuthMock.mockReturnValue({
      token: null,
      user: { id: "1", email: "learner@example.com", displayName: "Learner", role: "user" },
      ready: true,
      error: null,
      signIn: vi.fn(),
      register: vi.fn()
    });

    renderAt("/app/markets/ALFA");
    expect(await screen.findByText("Market detail route is intact")).toBeTruthy();
  });

  it("redirects signed-out dashboard visits to login", async () => {
    renderAt("/app/dashboard");

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("keeps the admin workspace available only to admins", async () => {
    useAuthMock.mockReturnValue({
      token: "admin-token",
      user: { id: "2", email: "admin@example.com", displayName: "Admin", role: "admin" },
      ready: true,
      error: null,
      signIn: vi.fn(),
      register: vi.fn()
    });

    renderAt("/admin/users");
    expect(await screen.findByRole("heading", { name: "Admin workspace" }, { timeout: 5_000 })).toBeTruthy();
  });

  it("shows an explicit market-feed error instead of invented quotes", async () => {
    apiRequestMock.mockRejectedValue(new Error("feed offline"));
    renderAt();

    expect(await screen.findByText("Market feed is temporarily unavailable.", {}, { timeout: 3_000 })).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("ALFA")).toBeNull();
  });
});

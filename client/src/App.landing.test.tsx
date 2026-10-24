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
vi.mock("./Dashboard", () => ({
  Dashboard: () => <div>Dashboard route is intact</div>
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

const candles = {
  candles: [{
    instrumentId: "8af8401d-00c7-49f0-aeae-914c82dbdd72",
    ts: "2026-10-24T00:00:00.000Z",
    openPaise: 12_300_000,
    highPaise: 12_600_000,
    lowPaise: 12_200_000,
    closePaise: 12_500_000,
    volume: 100
  }]
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
    user: null,
    ready: true,
    error: null,
    signIn: vi.fn(),
    register: vi.fn()
  });
  apiRequestMock.mockImplementation((path: string) => Promise.resolve(
    path === "/api/quotes" ? { quotes: [quote] } : candles
  ));
});

describe("public landing route", () => {
  it("shows the landing content and validated live market preview", async () => {
    renderAt();

    expect(screen.getByRole("heading", { name: "Practice trading. Understand every trade." })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Questions, answered." })).toBeTruthy();
    expect(screen.getByRole("group", { name: "TradeWise learning trace" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Observe" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Check" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reflect" })).toBeTruthy();
    expect(screen.getByText("Simulated trading with virtual money. Not financial advice.")).toBeTruthy();
    expect((await screen.findAllByText("ALFA")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("₹1,25,000.00")).length).toBeGreaterThan(0);
    expect(await screen.findByRole("img", { name: "ALFA daily closing prices from real market candle data" })).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith("/api/market/ALFA/candles?interval=1d&limit=48", expect.anything());
  });

  it("routes signed-out primary calls to registration", async () => {
    renderAt();
    fireEvent.click(screen.getByRole("link", { name: "Start practicing" }));

    expect(await screen.findByLabelText("Display name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
  });

  it("routes a signed-in call to the protected dashboard", async () => {
    useAuthMock.mockReturnValue({
      user: { id: "1", email: "learner@example.com", displayName: "Learner", role: "user" },
      ready: true,
      error: null,
      signIn: vi.fn(),
      register: vi.fn()
    });

    renderAt();
    fireEvent.click(screen.getByRole("link", { name: "Go to your dashboard" }));

    expect(await screen.findByText("Dashboard route is intact")).toBeTruthy();
  });

  it("keeps the explicit dashboard route protected and available", async () => {
    useAuthMock.mockReturnValue({
      user: { id: "1", email: "learner@example.com", displayName: "Learner", role: "user" },
      ready: true,
      error: null,
      signIn: vi.fn(),
      register: vi.fn()
    });

    renderAt("/app/dashboard");
    await waitFor(() => expect(screen.getByText("Dashboard route is intact")).toBeTruthy());
  });

  it("redirects signed-out dashboard visits to login", async () => {
    renderAt("/app/dashboard");

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("keeps the admin workspace available only to admins", async () => {
    useAuthMock.mockReturnValue({
      user: { id: "2", email: "admin@example.com", displayName: "Admin", role: "admin" },
      ready: true,
      error: null,
      signIn: vi.fn(),
      register: vi.fn()
    });

    renderAt("/admin/users");
    expect(await screen.findByRole("heading", { name: "Admin workspace" })).toBeTruthy();
  });

  it("shows an explicit quote error instead of invented prices", async () => {
    apiRequestMock.mockRejectedValue(new Error("feed offline"));
    renderAt();

    expect(await screen.findByText("Live quotes are temporarily unavailable.", {}, { timeout: 3_000 })).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.queryByText("₹1,25,000.00")).toBeNull();
  });
});

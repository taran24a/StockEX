import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DashboardOverview } from "./DashboardOverview";

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));
vi.mock("./api", () => ({ apiRequest: apiRequestMock }));
vi.mock("./auth", () => ({
  useAuth: () => ({ token: "signed-in-token", user: { id: "8af8401d-00c7-49f0-aeae-914c82dbdd72", email: "learner@example.com", displayName: "Learner", role: "user" } })
}));
vi.mock("./LivePriceChart", () => ({
  LivePriceChart: ({ data, ariaLabel }: { data: Array<{ value: number }>; ariaLabel: string }) =>
    <div aria-label={ariaLabel} data-values={data.map((point) => point.value).join(",")} role="img" />
}));

const portfolio = {
  accountId: "8af8401d-00c7-49f0-aeae-914c82dbdd72",
  cashBalancePaise: 7_500_000,
  reservedBalancePaise: 0,
  totalEquityPaise: 23_450_000,
  holdings: [{
    instrumentId: "90000000-0000-4000-8000-000000000001",
    symbol: "ALFA",
    quantity: 2,
    averageCostPaise: 8_000_000,
    marketPricePaise: 7_975_000,
    marketValuePaise: 15_950_000,
    unrealizedPnlPaise: -50_000
  }]
};
const performance = {
  realizedPnlPaise: 12_000,
  unrealizedPnlPaise: -50_000,
  dayChangePaise: 25_000,
  holdingContributions: [{ symbol: "ALFA", dayChangeContributionPaise: 25_000 }],
  equityCurve: [
    { timestamp: "2026-10-24T09:30:00.000Z", equityPaise: 23_100_000 },
    { timestamp: "2026-10-24T10:30:00.000Z", equityPaise: 23_450_000 }
  ]
};
const orders = {
  orders: [{
    id: "90000000-0000-4000-8000-000000000002",
    accountId: portfolio.accountId,
    instrumentId: "90000000-0000-4000-8000-000000000001",
    symbol: "ALFA",
    side: "buy",
    type: "market",
    quantity: 3,
    limitPricePaise: null,
    filledQuantity: 2,
    status: "partially_filled",
    idempotencyKey: null,
    createdAt: "2026-10-24T10:31:00.000Z"
  }],
  pagination: { limit: 5, offset: 0, total: 1 }
};
const riskSummary = {
  accountId: portfolio.accountId,
  totalEquityPaise: portfolio.totalEquityPaise,
  singleStocks: [{ name: "ALFA", sector: "Technology", marketValuePaise: 15_950_000, concentrationPct: 68 }],
  sectors: [{ name: "Technology", marketValuePaise: 15_950_000, concentrationPct: 68 }],
  warnings: ["ALFA is above the concentration guide."]
};
const riskAlerts = {
  alerts: [{
    id: "90000000-0000-4000-8000-000000000003",
    accountId: portfolio.accountId,
    ruleId: null,
    orderId: null,
    alertType: "concentration",
    severity: "warning",
    message: "ALFA concentration is elevated.",
    details: {},
    acknowledgedAt: null,
    createdAt: "2026-10-24T10:30:00.000Z"
  }],
  pagination: { limit: 5, offset: 0, total: 1 }
};

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderOverview(client = createClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><DashboardOverview /></MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/portfolio") return Promise.resolve(portfolio);
    if (path === "/api/v1/portfolio/performance") return Promise.resolve(performance);
    if (path.startsWith("/api/v1/orders")) return Promise.resolve(orders);
    if (path === "/api/watchlists") return Promise.resolve({
      watchlists: [{
        id: "90000000-0000-4000-8000-000000000004",
        name: "Study list",
        createdAt: "2026-10-24T09:00:00.000Z",
        updatedAt: "2026-10-24T09:00:00.000Z",
        instruments: [{ symbol: "ALFA", name: "Alfa Compute Systems", pricePaise: 12_500_000 }]
      }]
    });
    if (path === "/api/quotes") return Promise.resolve({ quotes: [{
      symbol: "ALFA", name: "Alfa Compute Systems", pricePaise: 12_500_000, changePaise: 12_500, updatedAt: "2026-10-24T10:30:00.000Z"
    }] });
    if (path === "/api/risk/summary") return Promise.resolve(riskSummary);
    if (path.startsWith("/api/risk/alerts")) return Promise.resolve(riskAlerts);
    throw new Error(`Unexpected API request: ${path}`);
  });
});

describe("dashboard overview", () => {
  it("renders account metrics, live holdings, watchlist, orders, risk, and actual equity snapshots", async () => {
    renderOverview();

    expect((await screen.findAllByText("₹2,34,500.00")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("₹75,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText("+₹250.00")).toBeTruthy();
    expect(screen.getAllByText("−₹500.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Live holdings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Capital allocation" })).toBeTruthy();
    expect(screen.getByRole("img", {
      name: "Capital allocation: cash 32.0 percent, holdings 68.0 percent"
    })).toBeTruthy();
    expect(screen.getByText("Holdings market value")).toBeTruthy();
    expect(screen.getByText("ALFA concentration is elevated.")).toBeTruthy();
    expect(screen.getByText("partially filled")).toBeTruthy();
    expect(screen.getByText("₹1,25,000.00")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Scrollable holdings table" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("region", { name: "Scrollable recent orders table" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getAllByText("Swipe or scroll horizontally to see all columns")).toHaveLength(2);
    expect(screen.getByRole("img", { name: /Portfolio equity curve.*2 snapshots/ }).getAttribute("data-values")).toBe("23100000,23450000");
    expect(apiRequestMock).toHaveBeenCalledWith("/api/v1/portfolio/performance", expect.anything(), "signed-in-token");
    expect(apiRequestMock).toHaveBeenCalledWith("/api/v1/orders?limit=5&offset=0", expect.anything(), "signed-in-token");
  });

  it("shows loading states without inventing financial values", () => {
    apiRequestMock.mockReturnValue(new Promise(() => undefined));
    renderOverview();

    expect(screen.getByRole("status", { name: "Loading total equity" })).toBeTruthy();
    expect(screen.getByText("Loading equity history…")).toBeTruthy();
    expect(screen.queryByText(/₹/)).toBeNull();
  });

  it("shows honest empty states when account history and positions are empty", async () => {
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/portfolio") return Promise.resolve({ ...portfolio, cashBalancePaise: 0, totalEquityPaise: 0, holdings: [] });
      if (path === "/api/v1/portfolio/performance") return Promise.resolve({ ...performance, equityCurve: [], holdingContributions: [] });
      if (path.startsWith("/api/v1/orders")) return Promise.resolve({ orders: [], pagination: { limit: 5, offset: 0, total: 0 } });
      if (path === "/api/watchlists") return Promise.resolve({ watchlists: [] });
      if (path === "/api/quotes") return Promise.resolve({ quotes: [] });
      if (path === "/api/risk/summary") return Promise.resolve({ ...riskSummary, singleStocks: [], sectors: [], warnings: [] });
      if (path.startsWith("/api/risk/alerts")) return Promise.resolve({ alerts: [], pagination: { limit: 5, offset: 0, total: 0 } });
      throw new Error(`Unexpected API request: ${path}`);
    });
    renderOverview();

    expect(await screen.findByText("No equity snapshots have been recorded yet.")).toBeTruthy();
    expect(screen.getByText("No open positions yet.")).toBeTruthy();
    expect(screen.getByText("You haven’t created a watchlist yet. Visit Markets to explore live quotes.")).toBeTruthy();
    expect(screen.getByText("No active risk warnings.")).toBeTruthy();
    expect(screen.getByText("No orders on this page.")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /equity curve/i })).toBeNull();
    expect(screen.queryByRole("img", { name: /capital allocation/i })).toBeNull();
    expect(screen.getAllByText("₹0.00").length).toBeGreaterThan(0);
  });

  it("shows endpoint errors rather than fallback financial numbers", async () => {
    apiRequestMock.mockRejectedValue(new Error("Portfolio service unavailable"));
    renderOverview();

    expect(await screen.findAllByText("Portfolio service unavailable")).not.toHaveLength(0);
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("₹1,00,000.00")).toBeNull();
  });
});

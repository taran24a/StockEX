import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PortfolioPage } from "./Portfolio";

const { apiRequestMock, useAuthMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  useAuthMock: vi.fn()
}));

vi.mock("./api", () => ({ apiRequest: apiRequestMock }));
vi.mock("./auth", () => ({ useAuth: useAuthMock }));

const accountId = "773a2a95-9244-44ad-93f0-66f210c47918";
const portfolio = {
  accountId,
  cashBalancePaise: 100_000,
  reservedBalancePaise: 2_000,
  totalEquityPaise: 148_000,
  holdings: [{
    instrumentId: "e246e1cb-8d22-4e59-b139-8fbaf801874d",
    symbol: "ALFA",
    quantity: 4,
    averageCostPaise: 10_000,
    marketPricePaise: 12_000,
    marketValuePaise: 48_000,
    unrealizedPnlPaise: 8_000
  }]
};
const performance = {
  realizedPnlPaise: 1_000,
  unrealizedPnlPaise: 8_000,
  dayChangePaise: 500,
  holdingContributions: [{ symbol: "ALFA", dayChangeContributionPaise: 500 }],
  equityCurve: []
};
const riskSummary = {
  accountId,
  totalEquityPaise: portfolio.totalEquityPaise,
  singleStocks: [{ name: "ALFA", sector: "Technology", marketValuePaise: 48_000, concentrationPct: 32.43 }],
  sectors: [{ name: "Technology", marketValuePaise: 48_000, concentrationPct: 32.43 }],
  warnings: []
};
const ledger = {
  entries: [{
    id: "cf54e518-69f6-4bc9-9961-96eec0917c93",
    accountId,
    fillId: null,
    entryType: "deposit",
    amountPaise: 100_000,
    balanceAfterPaise: 100_000,
    createdAt: "2026-05-01T10:00:00.000Z"
  }],
  pagination: { limit: 20, offset: 0, total: 1 }
};

function renderPortfolio() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><PortfolioPage /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  useAuthMock.mockReturnValue({ token: "signed-token" });
  apiRequestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/portfolio") return Promise.resolve(portfolio);
    if (path === "/api/v1/portfolio/performance") return Promise.resolve(performance);
    if (path === "/api/risk/summary") return Promise.resolve(riskSummary);
    if (path.startsWith("/api/v1/ledger?")) return Promise.resolve(ledger);
    if (path === "/api/v1/portfolio/verify") return Promise.resolve({ match: false, differences: [{ field: "cashBalancePaise", live: 100_000, rebuilt: 99_000 }] });
    return Promise.reject(new Error(`Unexpected API request: ${path}`));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("portfolio workspace", () => {
  it("shows holdings, stock and sector allocation, performance contributions, and ledger entries", async () => {
    renderPortfolio();

    const holdingRow = await screen.findByRole("row", { name: /ALFA/ });
    expect(holdingRow.textContent).toContain("₹80.00");
    expect(screen.getByRole("img", { name: "By stock allocation donut" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "By sector allocation donut" })).toBeTruthy();
    expect(screen.getByText("Technology")).toBeTruthy();
    expect(screen.getByText("Contribution by holding")).toBeTruthy();
    expect(await screen.findByText("deposit")).toBeTruthy();
    expect(screen.getByText("₹1,000.00")).toBeTruthy();
  });

  it("shows replay verification differences instead of reporting a false match", async () => {
    renderPortfolio();
    fireEvent.click(screen.getByRole("button", { name: "Verify with replay" }));

    const result = await screen.findByRole("status", { name: "Portfolio verification result" });
    expect(within(result).getByText("Portfolio differs from replay")).toBeTruthy();
    expect(within(result).getByText("cashBalancePaise")).toBeTruthy();
    expect(within(result).getByText("Live: 100000 · Replay: 99000")).toBeTruthy();
  });

  it("downloads the streamed CSV using the authenticated session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["date,amount"], { type: "text/csv" }))
    });
    const createObjectURL = vi.fn(() => "blob:statement");
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    vi.stubGlobal("fetch", fetchMock);
    renderPortfolio();
    fireEvent.click(screen.getByRole("button", { name: "Download statement (CSV)" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/portfolio/statement.csv", {
      headers: { Authorization: "Bearer signed-token", Accept: "text/csv" }
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(await screen.findByText("Statement CSV download started.")).toBeTruthy();
  });
});

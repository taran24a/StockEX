import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api";
import { MarketsPage, OrderTicket } from "./Markets";

const { apiRequestMock, useAuthMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  useAuthMock: vi.fn()
}));

vi.mock("./api", () => ({
  ApiClientError: class ApiClientError extends Error {
    constructor(message: string, public status: number, public code: string) {
      super(message);
    }
  },
  apiRequest: apiRequestMock
}));
vi.mock("./auth", () => ({ useAuth: useAuthMock }));

const instrument = {
  id: "e246e1cb-8d22-4e59-b139-8fbaf801874d",
  symbol: "ALFA",
  name: "Alfa Industries",
  sector: "Technology",
  tickSizePaise: 1,
  lastPricePaise: 12_500,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};
const quote = {
  symbol: "ALFA",
  name: "Alfa Industries",
  pricePaise: 12_500,
  changePaise: 100,
  updatedAt: "2026-01-01T00:00:00.000Z"
};
const watchlist = {
  id: "927a6950-df0f-42cf-9a4c-8e08624bb00e",
  name: "Markets",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  instruments: []
};
const portfolio = {
  accountId: "773a2a95-9244-44ad-93f0-66f210c47918",
  cashBalancePaise: 100_000,
  reservedBalancePaise: 2_000,
  holdings: [],
  totalEquityPaise: 98_000
};
const orderResponse = {
  id: "a180a454-a2db-43f7-8e18-a8c44d4f781c",
  accountId: portfolio.accountId,
  instrumentId: instrument.id,
  symbol: "ALFA",
  side: "buy",
  type: "market",
  quantity: 1,
  limitPricePaise: null,
  filledQuantity: 1,
  status: "filled",
  idempotencyKey: "test-key",
  createdAt: "2026-01-01T00:00:00.000Z",
  pricePaise: quote.pricePaise,
  totalPaise: quote.pricePaise
};

function renderPage(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

beforeEach(() => {
  apiRequestMock.mockReset();
  useAuthMock.mockReturnValue({ token: "signed-token" });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("markets workspace", () => {
  it("searches and filters the live instrument table and adds an instrument to a new watchlist", async () => {
    apiRequestMock.mockImplementation((path: string, _schema: unknown, _token: string | undefined, init?: RequestInit) => {
      if (path === "/api/market/instruments") {
        return Promise.resolve({
          instruments: [
            { instrument, quote },
            {
              instrument: { ...instrument, symbol: "BRAVO", name: "Bravo Energy", sector: "Energy" },
              quote: { ...quote, symbol: "BRAVO", name: "Bravo Energy" }
            }
          ]
        });
      }
      if (path === "/api/quotes") return Promise.resolve({ quotes: [quote, { ...quote, symbol: "BRAVO", name: "Bravo Energy" }] });
      if (path === "/api/watchlists" && init?.method === "POST") return Promise.resolve(watchlist);
      if (path === "/api/watchlists") return Promise.resolve({ watchlists: [] });
      if (path.includes("/instruments/ALFA")) return Promise.resolve({ ...watchlist, instruments: [{ symbol: "ALFA", name: instrument.name, pricePaise: quote.pricePaise }] });
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    });

    renderPage(<MarketsPage />);
    expect(await screen.findByRole("link", { name: /ALFA Alfa Industries/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /BRAVO Bravo Energy/ })).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by sector" }), { target: { value: "Energy" } });
    expect(screen.queryByRole("link", { name: /ALFA Alfa Industries/ })).toBeNull();
    expect(screen.getByRole("link", { name: /BRAVO Bravo Energy/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by sector" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search instruments" }), { target: { value: "alfa" } });
    expect(screen.getByRole("link", { name: /ALFA Alfa Industries/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /BRAVO Bravo Energy/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add ALFA to watchlist" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      `/api/watchlists/${watchlist.id}/instruments/ALFA`,
      expect.anything(),
      "signed-token",
      { method: "POST" }
    ));
  });

  it("submits idempotent limit orders and supports B/S shortcuts without intercepting form input", async () => {
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/portfolio") return Promise.resolve(portfolio);
      if (path === "/api/v1/orders") return Promise.resolve({ ...orderResponse, side: "sell", type: "limit", limitPricePaise: 12_500 });
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    });
    vi.spyOn(window.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");

    renderPage(<OrderTicket quote={quote} symbol="ALFA" />);
    expect(await screen.findByText("Buying power")).toBeTruthy();
    expect(screen.getByText("₹980.00")).toBeTruthy();

    fireEvent.keyDown(document, { key: "s" });
    expect(screen.getByRole("button", { name: "SELL", pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "LIMIT" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Order quantity" }), { target: { value: "2" } });
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Order quantity" }), { key: "b" });
    expect(screen.getByRole("button", { name: "SELL", pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "SELL" }));
    fireEvent.click(screen.getByRole("button", { name: "SELL ALFA" }));

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/v1/orders",
      expect.anything(),
      "signed-token",
      expect.objectContaining({
        method: "POST",
        headers: { "Idempotency-Key": "00000000-0000-4000-8000-000000000001" },
        body: JSON.stringify({
          symbol: "ALFA",
          side: "sell",
          type: "limit",
          quantity: 2,
          limitPricePaise: 12_500
        })
      })
    ));
    expect((await screen.findByRole("status")).textContent).toContain("Order filled · 1 ALFA share(s) · LIMIT");
  });

  it("surfaces a human-readable risk rejection from the order API", async () => {
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/portfolio") return Promise.resolve(portfolio);
      if (path === "/api/v1/orders") return Promise.reject(new ApiClientError("Order exceeds your risk limit.", 422, "RISK_REJECTED"));
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    });

    renderPage(<OrderTicket quote={quote} symbol="ALFA" />);
    fireEvent.click(await screen.findByRole("button", { name: "BUY ALFA" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Risk rejected: Order exceeds your risk limit.");
  });
});

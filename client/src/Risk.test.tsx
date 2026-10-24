import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RiskPage } from "./Risk";

const { apiRequestMock, useAuthMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  useAuthMock: vi.fn()
}));

vi.mock("./api", () => ({ apiRequest: apiRequestMock }));
vi.mock("./auth", () => ({ useAuth: useAuthMock }));

const accountId = "773a2a95-9244-44ad-93f0-66f210c47918";
const instrumentId = "e246e1cb-8d22-4e59-b139-8fbaf801874d";
const alertId = "cf54e518-69f6-4bc9-9961-96eec0917c93";
const rules = {
  accountId,
  maxOrderNotionalPaise: 1_000_000,
  maxSingleStockConcentrationPct: 45,
  maxSectorConcentrationPct: 55,
  createdAt: "2026-10-25T10:00:00.000Z",
  updatedAt: "2026-10-25T10:00:00.000Z"
};
const summary = {
  accountId,
  totalEquityPaise: 100_000,
  singleStocks: [{ name: "ALFA", sector: "Technology", marketValuePaise: 42_000, concentrationPct: 42 }],
  sectors: [{ name: "Technology", marketValuePaise: 42_000, concentrationPct: 42 }],
  warnings: []
};
const instrument = {
  id: instrumentId,
  symbol: "ALFA",
  name: "Alfa Industries",
  sector: "Technology",
  tickSizePaise: 1,
  lastPricePaise: 10_000,
  createdAt: "2026-10-25T10:00:00.000Z",
  updatedAt: "2026-10-25T10:00:00.000Z"
};
let acknowledgedAt: string | null;

function renderRiskPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><RiskPage /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  acknowledgedAt = null;
  apiRequestMock.mockReset();
  useAuthMock.mockReturnValue({ token: "signed-token" });
  apiRequestMock.mockImplementation((path: string, _schema: unknown, _token: string | undefined, init?: RequestInit) => {
    if (path === "/api/v1/risk/rules" && init?.method === "PUT") return Promise.resolve(rules);
    if (path === "/api/v1/risk/rules") return Promise.resolve(rules);
    if (path === "/api/v1/risk/summary") return Promise.resolve(summary);
    if (path === "/api/market/instruments") return Promise.resolve({ instruments: [{ instrument, quote: null }] });
    if (path.startsWith("/api/v1/risk/alerts?")) return Promise.resolve({
      alerts: [{
        id: alertId,
        accountId,
        ruleId: null,
        orderId: null,
        alertType: "CONCENTRATION_WARNING",
        severity: "warning",
        message: "ALFA is approaching its single-stock threshold",
        details: {},
        acknowledgedAt,
        createdAt: "2026-10-25T10:00:00.000Z"
      }],
      pagination: { limit: 50, offset: 0, total: 1 }
    });
    if (path === "/api/v1/risk/preview") return Promise.resolve({
      symbol: "ALFA",
      sector: "Technology",
      side: "buy",
      quantity: 2,
      pricePaise: 10_000,
      orderNotionalPaise: 20_000,
      totalEquityPaise: 100_000,
      currentStockPct: 42,
      projectedStockPct: 62,
      currentSectorPct: 42,
      projectedSectorPct: 62,
      rejection: "This trade would raise ALFA from 42% to 62%, exceeding your 45% limit"
    });
    if (path === `/api/v1/risk/alerts/${alertId}`) {
      const input = JSON.parse(String(init?.body)) as { acknowledged: boolean };
      acknowledgedAt = input.acknowledged ? "2026-10-25T11:00:00.000Z" : null;
      return Promise.resolve({
        id: alertId,
        accountId,
        ruleId: null,
        orderId: null,
        alertType: "CONCENTRATION_WARNING",
        severity: "warning",
        message: "ALFA is approaching its single-stock threshold",
        details: {},
        acknowledgedAt,
        createdAt: "2026-10-25T10:00:00.000Z"
      });
    }
    return Promise.reject(new Error(`Unexpected API request: ${path}`));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("risk workspace", () => {
  it("validates and saves risk thresholds and colors near-limit concentrations", async () => {
    renderRiskPage();
    expect(await screen.findByRole("meter", { name: /Stock ALFA concentration/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Maximum single-stock concentration/), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: "Save risk limits" }));
    expect(screen.getByLabelText(/Maximum single-stock concentration/).getAttribute("aria-invalid")).toBe("true");
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      "/api/v1/risk/rules",
      expect.anything(),
      "signed-token",
      expect.objectContaining({ method: "PUT" })
    );

    fireEvent.change(screen.getByLabelText(/Maximum single-stock concentration/), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save risk limits" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/v1/risk/rules",
      expect.anything(),
      "signed-token",
      { method: "PUT", body: JSON.stringify({
        maxOrderNotionalPaise: 1_000_000,
        maxSingleStockConcentrationPct: 50,
        maxSectorConcentrationPct: 55
      }) }
    ));
  });

  it("previews a hypothetical order and clearly shows a risk rejection", async () => {
    renderRiskPage();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "ALFA" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview concentration" }));

    const result = await screen.findByRole("status", { name: "What-if preview result" });
    expect(within(result).getByText("Would be rejected by risk limits")).toBeTruthy();
    expect(within(result).getByText(/exceeding your 45% limit/)).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/v1/risk/preview",
      expect.anything(),
      "signed-token",
      { method: "POST", body: JSON.stringify({ symbol: "ALFA", side: "buy", quantity: 2 }) }
    );
  });

  it("toggles risk alerts between unread and read", async () => {
    renderRiskPage();
    const alert = await screen.findByText("ALFA is approaching its single-stock threshold");
    const alertRow = alert.closest("li");
    if (alertRow === null) throw new Error("Risk alert row was not rendered");
    fireEvent.click(within(alertRow).getByRole("button", { name: "Mark as read" }));
    expect(await within(alertRow).findByText("Read")).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith(
      `/api/v1/risk/alerts/${alertId}`,
      expect.anything(),
      "signed-token",
      { method: "PATCH", body: JSON.stringify({ acknowledged: true }) }
    );
  });
});

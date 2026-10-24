import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { OrdersPage } from "./Orders";

const { apiRequestMock, useAuthMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  useAuthMock: vi.fn()
}));

vi.mock("./api", () => ({ apiRequest: apiRequestMock }));
vi.mock("./auth", () => ({ useAuth: useAuthMock }));

const order = {
  id: "4b8fbe96-52f4-45b9-a373-195af22bcf22",
  accountId: "ac8fbe96-52f4-45b9-a373-195af22bcf22",
  instrumentId: "dc8fbe96-52f4-45b9-a373-195af22bcf22",
  symbol: "ALFA",
  side: "buy",
  type: "limit",
  quantity: 4,
  limitPricePaise: 12_500,
  filledQuantity: 0,
  status: "open",
  idempotencyKey: "key",
  createdAt: "2026-10-25T10:00:00.000Z",
  pricePaise: 12_500,
  totalPaise: 50_000
};

function renderOrders(path = "/app/orders") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<OrdersPage />} path="/app/orders" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  useAuthMock.mockReturnValue({ token: "signed-token" });
  apiRequestMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/orders?")) {
      const offset = new URLSearchParams(path.split("?")[1]).get("offset");
      return Promise.resolve({
        orders: [order],
        pagination: { limit: 20, offset: Number(offset ?? 0), total: offset === "40" ? 41 : 1 }
      });
    }
    if (path.endsWith("/timeline")) return Promise.resolve({
      orderId: order.id,
      events: [{
        id: "5b8fbe96-52f4-45b9-a373-195af22bcf22",
        eventType: "RISK_CHECK_PASSED",
        sequenceNumber: 1,
        message: "Pre-trade risk checks passed for ALFA",
        payload: { symbol: "ALFA" },
        createdAt: "2026-10-25T10:00:01.000Z"
      }]
    });
    if (path.endsWith("/replay")) return Promise.resolve({
      orderId: order.id,
      frames: [
        {
          eventId: "6b8fbe96-52f4-45b9-a373-195af22bcf22",
          eventType: "ORDER_VALIDATED",
          message: "Order validation passed for ALFA",
          createdAt: "2026-10-25T10:00:00.000Z",
          cashBalancePaise: 50_000,
          holdings: []
        },
        {
          eventId: "7b8fbe96-52f4-45b9-a373-195af22bcf22",
          eventType: "ORDER_ACCEPTED",
          message: "Order accepted for ALFA",
          createdAt: "2026-10-25T10:00:02.000Z",
          cashBalancePaise: 49_000,
          holdings: [{ symbol: "ALFA", quantity: 1, averageCostPaise: 12_500 }]
        }
      ]
    });
    if (path.endsWith("/cancel")) return Promise.resolve({ id: order.id, status: "cancelled", releasedReservationPaise: 50_000 });
    return Promise.reject(new Error(`Unexpected API request: ${path}`));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("orders workspace", () => {
  it("applies filters from URL query parameters and paginates through the API", async () => {
    renderOrders("/app/orders?status=open&side=buy&symbol=alfa&date=2026-10-25&page=2");
    expect(await screen.findByText("ALFA")).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/v1/orders?limit=20&offset=40&status=open&side=buy&symbol=ALFA&date=2026-10-25",
      expect.anything(),
      "signed-token"
    );
    expect(screen.getByText("Showing 41–41 of 41")).toBeTruthy();
  });

  it("opens timeline and steps through cash and holdings replay", async () => {
    renderOrders();
    const row = await screen.findByRole("row", { name: /ALFA/ });
    fireEvent.click(row);

    expect(await screen.findByRole("dialog", { name: "ALFA order" })).toBeTruthy();
    expect(await screen.findByText("Pre-trade risk checks passed for ALFA")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Next replay step" }));
    expect(await screen.findByText("Order validation passed for ALFA")).toBeTruthy();
    expect(screen.getByText("₹500.00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next replay step" }));
    expect(await screen.findByText("Order accepted for ALFA")).toBeTruthy();
    expect(screen.getByText("₹490.00")).toBeTruthy();
    expect(screen.getByText("ALFA · 1 shares")).toBeTruthy();
  });

  it("cancels an open order without opening the detail modal", async () => {
    renderOrders();
    const row = await screen.findByRole("row", { name: /ALFA/ });
    fireEvent.click(within(row).getByRole("button", { name: "Cancel ALFA order" }));

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      `/api/v1/orders/${order.id}/cancel`,
      expect.anything(),
      "signed-token",
      { method: "POST" }
    ));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("surfaces invalid dates from the URL instead of sending an ambiguous filter", async () => {
    renderOrders("/app/orders?date=not-a-date");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});

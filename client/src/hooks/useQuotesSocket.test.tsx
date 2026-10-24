import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuotesSocket } from "./useQuotesSocket";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("../auth", () => ({ useAuth: useAuthMock }));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readonly url: string;
  readonly listeners = new Map<string, Array<(event: Event) => void>>();
  readonly send = vi.fn();
  readonly close = vi.fn(() => this.emit("close", new Event("close")));

  constructor(url: string | URL) {
    this.url = String(url);
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const entries = this.listeners.get(type) ?? [];
    entries.push(listener);
    this.listeners.set(type, entries);
  }

  emit(type: string, event: Event) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function SocketStatus() {
  const { status, error, recentOrderEvents } = useQuotesSocket();
  return (
    <div>
      <p aria-live="polite">Connection {status}</p>
      <p>Recent events {recentOrderEvents.length}</p>
      {error !== null && <p role="status">{error}</p>}
    </div>
  );
}

function renderSocket(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = render(
    <QueryClientProvider client={queryClient}><SocketStatus /></QueryClientProvider>
  );
  return { ...view, queryClient };
}

const quote = {
  symbol: "ALFA",
  name: "Alfa Compute Systems",
  pricePaise: 12_500_000,
  changePaise: 25_000,
  updatedAt: "2026-10-25T01:00:00.000Z"
};

beforeEach(() => {
  MockWebSocket.instances = [];
  useAuthMock.mockReturnValue({ token: "auth-token" });
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useQuotesSocket", () => {
  it("authenticates the URL and subscribes to the shared protocol after open", async () => {
    const { unmount } = renderSocket();
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0]!;

    expect(socket.url).toContain("ws://");
    expect(socket.url).toContain("/ws?token=auth-token");
    act(() => socket.emit("open", new Event("open")));
    expect(JSON.parse(socket.send.mock.calls[0]?.[0] as string)).toEqual({
      type: "subscribe",
      channels: ["quotes", "orders", "portfolio"]
    });
    expect(screen.getByText("Connection connected")).toBeTruthy();
    unmount();
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("validates quote updates into both quote caches and invalidates user account data for order and portfolio events", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["quotes"], { quotes: [] });
    queryClient.setQueryData(["landing", "quotes"], { quotes: [] });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const { unmount } = renderSocket(queryClient);
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0]!;
    act(() => socket.emit("open", new Event("open")));

    act(() => socket.emit("message", new MessageEvent("message", { data: JSON.stringify({ type: "quote", data: quote }) })));
    expect(queryClient.getQueryData(["quotes"])).toEqual({ quotes: [quote] });
    expect(queryClient.getQueryData(["landing", "quotes"])).toEqual({ quotes: [quote] });

    const orderUpdate = {
      type: "order.update",
      data: {
        id: "90000000-0000-4000-8000-000000000001",
        aggregateId: "90000000-0000-4000-8000-000000000002",
        eventType: "ORDER_FILLED",
        payload: { symbol: "ALFA" }
      }
    };
    act(() => socket.emit("message", new MessageEvent("message", { data: JSON.stringify(orderUpdate) })));
    expect(screen.getByText("Recent events 1")).toBeTruthy();

    const portfolioUpdate = {
      type: "portfolio.update",
      data: {
        accountId: "90000000-0000-4000-8000-000000000003",
        fillId: "90000000-0000-4000-8000-000000000004",
        symbol: "ALFA",
        side: "buy",
        quantity: 2,
        pricePaise: 12_500_000,
        feePaise: 0
      }
    };
    act(() => socket.emit("message", new MessageEvent("message", { data: JSON.stringify(portfolioUpdate) })));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["portfolio", "performance"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["orders"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["portfolio"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["risk"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["risk", "alerts"] });
    unmount();
  });

  it("surfaces malformed messages, reconnects after close, and cleans up on unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = renderSocket();
    await act(async () => Promise.resolve());
    const firstSocket = MockWebSocket.instances[0]!;
    act(() => firstSocket.emit("open", new Event("open")));
    act(() => firstSocket.emit("message", new MessageEvent("message", { data: "not json" })));
    expect(screen.getByText("A live update could not be read. The connection remains active.")).toBeTruthy();

    act(() => firstSocket.emit("close", new Event("close")));
    act(() => vi.advanceTimersByTime(1_000));
    expect(MockWebSocket.instances).toHaveLength(2);
    const secondSocket = MockWebSocket.instances[1]!;
    unmount();
    expect(secondSocket.close).toHaveBeenCalledOnce();
  });
});

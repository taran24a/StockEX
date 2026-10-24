import {
  BalanceResponseSchema,
  OrdersResponseSchema,
  PlaceOrderRequestSchema,
  PlaceOrderResponseSchema,
  PortfolioResponseSchema,
  QuotesResponseSchema,
  TradesResponseSchema,
  type Instrument,
} from "@tradewise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ChangeEvent } from "react";
import { ApiClientError, apiRequest } from "./api";
import { useAuth } from "./auth";
import { AdminUsersPanel } from "./AdminUsersPanel";
import { LivePriceChart, type PricePoint } from "./LivePriceChart";
import { formatPaise } from "./format";

const HISTORY_PAGE_SIZE = 20;
const HISTORY_LOOKAHEAD = HISTORY_PAGE_SIZE + 1;

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

// SYLLABUS: reusable components
// SYLLABUS: Tailwind
function HistoryPagination({
  label,
  page,
  hasNextPage,
  onPageChange
}: {
  label: string;
  page: number;
  hasNextPage: boolean;
  onPageChange(page: number): void;
}) {
  return (
    <nav aria-label={`${label} pagination`} className="mt-4 flex items-center justify-between text-sm">
      <button
        className="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
        type="button"
      >Previous</button>
      <span className="text-slate-500">Page {page + 1}</span>
      <button
        className="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!hasNextPage}
        onClick={() => onPageChange(page + 1)}
        type="button"
      >Next</button>
    </nav>
  );
}

function QueryError({ message }: { message: string }) {
  return <p className="rounded-lg border border-rose-900 bg-rose-950/50 p-3 text-sm text-rose-300" role="alert">{message}</p>;
}

// SYLLABUS: reusable components
function QuoteTable({
  quotes,
  selectedSymbol,
  onSelect
}: {
  quotes: Instrument[];
  selectedSymbol: string | null;
  onSelect(symbol: string): void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="py-3">Instrument</th><th>Price</th><th>Change</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {quotes.map((quote) => (
            <tr
              className={`border-t border-slate-800 ${selectedSymbol === quote.symbol ? "bg-slate-800/60" : "hover:bg-slate-800/30"}`}
              key={quote.symbol}
            >
              <td className="py-3 pr-3">
                <button className="text-left" onClick={() => onSelect(quote.symbol)} type="button">
                  <span className="font-semibold text-white">{quote.symbol}</span>
                  <span className="ml-2 hidden text-slate-500 sm:inline">{quote.name}</span>
                </button>
              </td>
              <td className="whitespace-nowrap font-medium text-slate-200">{formatPaise(quote.pricePaise)}</td>
              <td className={quote.changePaise >= 0 ? "whitespace-nowrap text-emerald-400" : "whitespace-nowrap text-rose-400"}>
                {quote.changePaise > 0 ? "+" : ""}{formatPaise(quote.changePaise)}
              </td>
              <td className="whitespace-nowrap text-xs text-slate-500">{new Date(quote.updatedAt).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderForm({
  token,
  quote,
  onOrderPlaced
}: {
  token: string;
  quote: Instrument | undefined;
  onOrderPlaced(): void;
}) {
  const queryClient = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("1");
  const mutation = useMutation({
    mutationFn: async () => {
      const input = PlaceOrderRequestSchema.parse({
        symbol: quote?.symbol,
        side,
        quantity: Number(quantity)
      });
      return apiRequest("/api/orders", PlaceOrderResponseSchema, token, {
        method: "POST",
        body: JSON.stringify(input)
      });
    },
    onSuccess: async () => {
      onOrderPlaced();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["wallet"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["trades"] })
      ]);
      setQuantity("1");
    }
  });

  const mutationError = mutation.error instanceof ApiClientError || mutation.error instanceof Error
    ? mutation.error.message
    : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <button
          className={`rounded-lg py-2 font-semibold ${side === "buy" ? "bg-emerald-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}
          onClick={() => setSide("buy")}
          type="button"
        >Buy</button>
        <button
          className={`rounded-lg py-2 font-semibold ${side === "sell" ? "bg-rose-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}
          onClick={() => setSide("sell")}
          type="button"
        >Sell</button>
      </div>
      <p className="text-sm text-slate-400">
        {quote === undefined ? "Select an instrument to place an order." : `${quote.name} (${quote.symbol}) · ${formatPaise(quote.pricePaise)} per share`}
      </p>
      <label className="block text-sm text-slate-300">
        Quantity
        <input
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          min="1"
          onChange={(event) => setQuantity(event.target.value)}
          step="1"
          type="number"
          value={quantity}
        />
      </label>
      {mutationError !== null && <QueryError message={mutationError} />}
      {mutation.isSuccess && (
        <p className="text-sm text-emerald-400" role="status">
          Filled {mutation.data.order.quantity} {mutation.data.order.symbol} share(s) at {formatPaise(mutation.data.order.pricePaise)}.
        </p>
      )}
      <button
        className={`w-full rounded-lg px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50 ${side === "buy" ? "bg-emerald-400 hover:bg-emerald-300" : "bg-rose-400 hover:bg-rose-300"}`}
        disabled={quote === undefined || mutation.isPending}
        type="submit"
      >
        {mutation.isPending ? "Submitting…" : `${side === "buy" ? "Buy" : "Sell"} ${quote?.symbol ?? "shares"}`}
      </button>
      <p className="text-xs leading-relaxed text-slate-500">Orders are simulated with virtual funds and are filled against the local synthetic quote feed.</p>
    </form>
  );
}

export function Dashboard() {
  const { token, user, avatarUrl, uploadAvatar, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [chartData, setChartData] = useState<PricePoint[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [ordersPage, setOrdersPage] = useState(0);
  const [tradesPage, setTradesPage] = useState(0);
  const quotesQuery = useQuery({
    queryKey: ["quotes"],
    queryFn: () => apiRequest("/api/quotes", QuotesResponseSchema),
    refetchInterval: 5_000
  });
  const walletQuery = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiRequest("/api/wallet", BalanceResponseSchema, token ?? undefined),
    enabled: token !== null
  });
  const portfolioQuery = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => apiRequest("/api/portfolio", PortfolioResponseSchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 5_000
  });
  const ordersQuery = useQuery({
    queryKey: ["orders", ordersPage],
    queryFn: () => apiRequest(
      `/api/orders?limit=${HISTORY_LOOKAHEAD}&offset=${ordersPage * HISTORY_PAGE_SIZE}`,
      OrdersResponseSchema,
      token ?? undefined
    ),
    enabled: token !== null
  });
  const tradesQuery = useQuery({
    queryKey: ["trades", tradesPage],
    queryFn: () => apiRequest(
      `/api/trades?limit=${HISTORY_LOOKAHEAD}&offset=${tradesPage * HISTORY_PAGE_SIZE}`,
      TradesResponseSchema,
      token ?? undefined
    ),
    enabled: token !== null
  });
  const quotes = quotesQuery.data?.quotes ?? [];
  const selectedQuote = quotes.find((quote) => quote.symbol === selectedSymbol) ?? quotes[0];

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) {
      return;
    }
    setAvatarError(null);
    try {
      await uploadAvatar(file);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Avatar upload failed");
    }
  }

  useEffect(() => {
    if (selectedSymbol === null && quotes.length > 0) {
      setSelectedSymbol(quotes[0]?.symbol ?? null);
    }
  }, [quotes, selectedSymbol]);

  useEffect(() => {
    const url = new URL("/api/quotes/ws", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    let active = true;

    socket.addEventListener("message", (event) => {
      try {
        const payload: unknown = JSON.parse(String(event.data));
        const parsed = QuotesResponseSchema.safeParse(payload);
        if (!parsed.success) {
          setStreamError("Live quote data failed validation. Polling will continue.");
          return;
        }
        queryClient.setQueryData(["quotes"], parsed.data);
        setStreamError(null);
      } catch {
        setStreamError("Live quote data could not be read. Polling will continue.");
      }
    });
    socket.addEventListener("error", () => {
      if (active) {
        setStreamError("Live quote connection is unavailable. Polling will continue.");
      }
    });

    return () => {
      active = false;
      socket.close();
    };
  }, [queryClient]);

  useEffect(() => {
    setChartData([]);
  }, [selectedSymbol]);

  useEffect(() => {
    if (selectedQuote === undefined) {
      return;
    }
    const seconds = Math.floor(Date.parse(selectedQuote.updatedAt) / 1_000);
    const point: PricePoint = { time: seconds as PricePoint["time"], value: selectedQuote.pricePaise };
    setChartData((current) => {
      const last = current[current.length - 1];
      if (last?.time === point.time) {
        return [...current.slice(0, -1), point];
      }
      return [...current, point].slice(-180);
    });
  }, [selectedQuote]);

  const pageErrors = [
    quotesQuery.error,
    walletQuery.error,
    portfolioQuery.error,
    ordersQuery.error,
    tradesQuery.error
  ].filter((error): error is Error => error instanceof Error);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-lg font-bold tracking-tight">TradeWise</p>
            <p className="text-xs text-slate-500">Paper trading · Virtual money only</p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400 hover:text-white">
              {avatarUrl === null
                ? <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 font-semibold text-emerald-300">{user?.displayName.slice(0, 1).toUpperCase()}</span>
                : <img alt="Profile avatar" className="h-9 w-9 rounded-full object-cover" src={avatarUrl} />}
              <span className="hidden sm:inline">Change avatar</span>
              <input
                accept="image/jpeg,image/png,image/webp"
                aria-label="Upload avatar"
                className="sr-only"
                onChange={(event) => void handleAvatarChange(event)}
                type="file"
              />
            </label>
            <span className="hidden text-sm text-slate-400 sm:inline">{user?.displayName}</span>
            <button className="text-sm text-slate-400 hover:text-white" onClick={signOut} type="button">Sign out</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-5 py-8">
        {avatarError !== null && <QueryError message={avatarError} />}
        {streamError !== null && <QueryError message={streamError} />}
        {pageErrors.map((error, index) => <QueryError key={`${error.message}-${index}`} message={error.message} />)}

        <section className="grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">Available virtual cash</p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {walletQuery.data === undefined ? "—" : formatPaise(walletQuery.data.balancePaise)}
            </p>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">Open positions</p>
            <p className="mt-2 text-3xl font-semibold text-white">{portfolioQuery.data?.positions.length ?? "—"}</p>
          </article>
        </section>

        <AdminUsersPanel role={user?.role ?? "user"} token={token} />

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h1 className="font-semibold text-white">Market watch</h1>
                  <p className="mt-1 text-xs text-slate-500">Live synthetic prices from the local feed</p>
                </div>
                {quotesQuery.isFetching && <span className="text-xs text-slate-500">Refreshing</span>}
              </div>
              {quotesQuery.isPending ? <p className="py-6 text-sm text-slate-500">Loading quotes…</p> : (
                <QuoteTable quotes={quotes} selectedSymbol={selectedQuote?.symbol ?? null} onSelect={setSelectedSymbol} />
              )}
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="mb-2">
                <h2 className="font-semibold text-white">{selectedQuote?.symbol ?? "Price"} chart</h2>
                <p className="text-xs text-slate-500">Prices collected during this session</p>
              </div>
              <LivePriceChart data={chartData} />
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h2 className="mb-3 font-semibold text-white">Portfolio</h2>
              {portfolioQuery.isPending ? <p className="text-sm text-slate-500">Loading portfolio…</p> :
                portfolioQuery.data?.positions.length === 0 ? <p className="text-sm text-slate-500">No open positions yet. Place a paper order to get started.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Symbol</th><th>Shares</th><th>Average cost</th><th>Market value</th><th>P/L</th></tr></thead>
                      <tbody>
                        {portfolioQuery.data?.positions.map((position) => (
                          <tr className="border-t border-slate-800" key={position.symbol}>
                            <td className="py-3 font-semibold">{position.symbol}</td>
                            <td>{position.quantity}</td>
                            <td>{formatPaise(position.averageCostPaise)}</td>
                            <td>{formatPaise(position.marketValuePaise)}</td>
                            <td className={position.profitLossPaise >= 0 ? "text-emerald-400" : "text-rose-400"}>{formatPaise(position.profitLossPaise)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </article>
          </div>

          <aside className="space-y-6">
            <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h2 className="mb-4 font-semibold text-white">Place market order</h2>
              {token !== null && (
                <OrderForm
                  key={selectedQuote?.symbol}
                  onOrderPlaced={() => {
                    setOrdersPage(0);
                    setTradesPage(0);
                  }}
                  quote={selectedQuote}
                  token={token}
                />
              )}
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h2 className="mb-3 font-semibold text-white">Recent orders</h2>
              {ordersQuery.isPending ? <p className="text-sm text-slate-500">Loading orders…</p> :
                ordersQuery.data?.orders.length === 0 ? <p className="text-sm text-slate-500">No orders on this page.</p> : (
                  <ul className="space-y-3">
                    {ordersQuery.data?.orders.slice(0, HISTORY_PAGE_SIZE).map((order) => (
                      <li className="flex items-center justify-between border-b border-slate-800 pb-3 text-sm" key={order.id}>
                        <span><strong className={order.side === "buy" ? "text-emerald-400" : "text-rose-400"}>{order.side.toUpperCase()}</strong> {order.quantity} {order.symbol}</span>
                        <span className="text-slate-400">{formatPaise(order.totalPaise)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              {!ordersQuery.isPending && ordersQuery.error === null && (
                <HistoryPagination
                  hasNextPage={(ordersQuery.data?.orders.length ?? 0) > HISTORY_PAGE_SIZE}
                  label="Orders"
                  onPageChange={setOrdersPage}
                  page={ordersPage}
                />
              )}
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h2 className="mb-3 font-semibold text-white">Trade history</h2>
              {tradesQuery.isPending ? <p className="text-sm text-slate-500">Loading trades…</p> :
                tradesQuery.data?.trades.length === 0 ? <p className="text-sm text-slate-500">No trades on this page.</p> : (
                  <ul className="space-y-3">
                    {tradesQuery.data?.trades.slice(0, HISTORY_PAGE_SIZE).map((trade) => (
                      <li className="border-b border-slate-800 pb-3 text-sm" key={trade.id}>
                        <div className="flex justify-between">
                          <span><strong className={trade.side === "buy" ? "text-emerald-400" : "text-rose-400"}>{trade.side.toUpperCase()}</strong> {trade.quantity} {trade.symbol}</span>
                          <span className="text-slate-400">{formatPaise(trade.totalPaise)}</span>
                        </div>
                        <time className="text-xs text-slate-500">{formatDate(trade.createdAt)}</time>
                      </li>
                    ))}
                  </ul>
                )}
              {!tradesQuery.isPending && tradesQuery.error === null && (
                <HistoryPagination
                  hasNextPage={(tradesQuery.data?.trades.length ?? 0) > HISTORY_PAGE_SIZE}
                  label="Trades"
                  onPageChange={setTradesPage}
                  page={tradesPage}
                />
              )}
            </article>
          </aside>
        </section>
      </div>
    </main>
  );
}

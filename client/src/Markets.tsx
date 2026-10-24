import {
  AccountPortfolioResponseSchema,
  CandlesResponseSchema,
  CreateWatchlistRequestSchema,
  MarketDepthResponseSchema,
  MarketInstrumentsResponseSchema,
  OrderRequestSchema,
  OrderResponseSchema,
  WatchlistDetailSchema,
  WatchlistsResponseSchema,
  QuotesResponseSchema,
  type Candle,
  type MarketInstrumentResponse,
  type Quote,
  type OrderSide
} from "@tradewise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type UTCTimestamp
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiClientError, apiRequest } from "./api";
import { useAuth } from "./auth";
import { formatPaise } from "./format";

type MarketInstrument = MarketInstrumentResponse;
type MarketQuote = Quote;

function QueryMessage({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`market-message ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{children}</p>;
}

function instrumentRows(
  instruments: MarketInstrument[],
  quotes: MarketQuote[]
): Array<{ instrument: MarketInstrument["instrument"]; quote: MarketQuote | null }> {
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  return instruments.map(({ instrument, quote }) => ({
    instrument,
    quote: quoteBySymbol.get(instrument.symbol) ?? quote
  }));
}

export function MarketsPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("all");
  const instruments = useQuery({
    queryKey: ["market", "instruments"],
    queryFn: () => apiRequest("/api/market/instruments", MarketInstrumentsResponseSchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 30_000
  });
  const quotes = useQuery({
    queryKey: ["quotes"],
    queryFn: () => apiRequest("/api/quotes", QuotesResponseSchema),
    refetchInterval: 5_000
  });
  const watchlists = useQuery({
    queryKey: ["watchlists"],
    queryFn: () => apiRequest("/api/watchlists", WatchlistsResponseSchema, token ?? undefined),
    enabled: token !== null
  });
  const addToWatchlist = useMutation({
    mutationFn: async (symbol: string) => {
      const list = watchlists.data?.watchlists[0];
      let watchlistId = list?.id;
      if (watchlistId === undefined) {
        const created = await apiRequest(
          "/api/watchlists",
          WatchlistDetailSchema,
          token ?? undefined,
          { method: "POST", body: JSON.stringify(CreateWatchlistRequestSchema.parse({ name: "Markets" })) }
        );
        watchlistId = created.id;
      }
      return apiRequest(
        `/api/watchlists/${watchlistId}/instruments/${encodeURIComponent(symbol)}`,
        WatchlistDetailSchema,
        token ?? undefined,
        { method: "POST" }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["watchlists"] });
    }
  });

  const liveQuotes = quotes.data?.quotes ?? [];
  const rows = useMemo(
    () => instrumentRows(instruments.data?.instruments ?? [], liveQuotes),
    [instruments.data?.instruments, liveQuotes]
  );
  const sectors = [...new Set(rows.map(({ instrument }) => instrument.sector))].sort((a, b) => a.localeCompare(b));
  const filteredRows = rows.filter(({ instrument }) => {
    const matchesSector = sector === "all" || instrument.sector === sector;
    const searchText = search.trim().toLowerCase();
    const matchesSearch = searchText === "" ||
      instrument.symbol.toLowerCase().includes(searchText) ||
      instrument.name.toLowerCase().includes(searchText);
    return matchesSector && matchesSearch;
  });
  const addedSymbols = new Set((watchlists.data?.watchlists ?? []).flatMap((list) =>
    list.instruments.map((item) => item.symbol)
  ));

  return (
    <div className="market-workspace">
      <header className="market-page-heading">
        <div>
          <p className="workspace-eyebrow">Explore the synthetic exchange</p>
          <h2>Markets</h2>
          <p>Follow live prices and add instruments to your watchlist.</p>
        </div>
        <span className="market-live-badge"><span /> Live quotes</span>
      </header>

      <section aria-label="Market instruments" className="workspace-panel market-list-panel">
        <div className="market-toolbar">
          <label className="market-search">
            <span>Search instruments</span>
            <input
              aria-label="Search instruments"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or symbol"
              type="search"
              value={search}
            />
          </label>
          <label className="market-sector-filter">
            <span>Sector</span>
            <select aria-label="Filter by sector" onChange={(event) => setSector(event.target.value)} value={sector}>
              <option value="all">All sectors</option>
              {sectors.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        {instruments.isPending ? <QueryMessage>Loading instruments…</QueryMessage> :
          instruments.error instanceof Error ? <QueryMessage error>Instruments could not be loaded: {instruments.error.message}</QueryMessage> :
            quotes.error instanceof Error && liveQuotes.length === 0 ? <QueryMessage error>Live quotes are unavailable: {quotes.error.message}</QueryMessage> :
              filteredRows.length === 0 ? <QueryMessage>No instruments match your search and sector filters.</QueryMessage> : (
                <div className="market-table-scroll">
                  <table className="market-table">
                    <thead><tr><th scope="col">Instrument</th><th scope="col">Sector</th><th scope="col">Last price</th><th scope="col">Change</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {filteredRows.map(({ instrument, quote }) => (
                        <tr key={instrument.symbol}>
                          <th scope="row">
                            <Link className="market-instrument-link" to={`/app/markets/${encodeURIComponent(instrument.symbol)}`}>
                              <strong>{instrument.symbol}</strong><span>{instrument.name}</span>
                            </Link>
                          </th>
                          <td>{instrument.sector}</td>
                          <td className="market-numeric">{quote === null ? "Quote unavailable" : formatPaise(quote.pricePaise)}</td>
                          <td className={`market-numeric ${quote === null ? "" : quote.changePaise >= 0 ? "is-gain" : "is-loss"}`}>
                            {quote === null ? "—" : `${quote.changePaise > 0 ? "+" : ""}${formatPaise(quote.changePaise)}`}
                          </td>
                          <td>{quote === null ? "—" : new Date(quote.updatedAt).toLocaleTimeString()}</td>
                          <td className="market-table-action">
                            <button
                              aria-label={addedSymbols.has(instrument.symbol) ? `${instrument.symbol} already in watchlist` : `Add ${instrument.symbol} to watchlist`}
                              disabled={addedSymbols.has(instrument.symbol) || addToWatchlist.isPending || watchlists.isPending || token === null}
                              onClick={() => addToWatchlist.mutate(instrument.symbol)}
                              type="button"
                            >
                              {addedSymbols.has(instrument.symbol) ? "Added" : addToWatchlist.variables === instrument.symbol && addToWatchlist.isPending ? "Adding…" : "Add to watchlist"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        {quotes.error instanceof Error && liveQuotes.length > 0 && (
          <p className="market-inline-warning" role="status">Live quote updates are temporarily unavailable. Showing the most recent prices.</p>
        )}
        {addToWatchlist.error instanceof Error && <QueryMessage error>Could not update your watchlist: {addToWatchlist.error.message}</QueryMessage>}
      </section>

      <button className="market-back-link" onClick={() => navigate("/app/dashboard")} type="button">Back to dashboard</button>
    </div>
  );
}

function CandlestickChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const chart = createChart(container, {
      width: container.clientWidth || 600,
      height: 320,
      layout: { background: { type: ColorType.Solid, color: "#0d141b" }, textColor: "#96a5ae" },
      grid: { vertLines: { color: "#1b2930" }, horzLines: { color: "#1b2930" } },
      rightPriceScale: { borderColor: "#26343d" },
      timeScale: { borderColor: "#26343d", timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: "#648879" }, horzLine: { color: "#648879" } }
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#80d39b",
      downColor: "#e58b8e",
      borderVisible: false,
      wickUpColor: "#80d39b",
      wickDownColor: "#e58b8e",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 }
    });
    series.setData(candles.map((candle) => ({
      time: Math.floor(Date.parse(candle.ts) / 1000) as UTCTimestamp,
      open: candle.openPaise / 100,
      high: candle.highPaise / 100,
      low: candle.lowPaise / 100,
      close: candle.closePaise / 100
    })));
    chart.timeScale().fitContent();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect.width;
          if (width !== undefined && width > 0) {
            chart.applyOptions({ width });
          }
        });
    resizeObserver?.observe(container);
    return () => {
        resizeObserver?.disconnect();
        chart.remove();
    };
  }, [candles]);

  return <div aria-label="Candlestick price chart" className="market-chart" ref={containerRef} />;
}

function formatRupeeInput(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

function parseRupeeInput(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (match === null) {
    return null;
  }
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const paise = BigInt(match[1]!) * 100n + BigInt(fraction || "0");
  return paise > 0n && paise <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(paise) : null;
}

function estimatedFeePaise(pricePaise: number, quantity: number): number {
  const notional = BigInt(pricePaise) * BigInt(quantity);
  const fee = (notional * 3n + 9_999n) / 10_000n;
  return Number(fee < 1n ? 1n : fee);
}

export function OrderTicket({
  symbol,
  quote
}: {
  symbol: string;
  quote: MarketQuote | null;
}) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [side, setSide] = useState<OrderSide>("buy");
  const [type, setType] = useState<"market" | "limit">("market");
  const [quantity, setQuantity] = useState("1");
  const [limitPrice, setLimitPrice] = useState(quote === null ? "" : formatRupeeInput(quote.pricePaise));
  const sideRef = useRef(side);
  sideRef.current = side;

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable ||
        target.closest("input, textarea, select, [contenteditable='true']") !== null
      )) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "b" || key === "s") {
        event.preventDefault();
        const nextSide = key === "b" ? "buy" : "sell";
        sideRef.current = nextSide;
        setSide(nextSide);
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (quote !== null && type === "limit") {
      setLimitPrice(formatRupeeInput(quote.pricePaise));
    }
  }, [quote?.pricePaise, type]);

  const portfolio = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => apiRequest("/api/v1/portfolio", AccountPortfolioResponseSchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 15_000
  });
  const parsedQuantity = /^\d+$/.test(quantity) ? Number(quantity) : 0;
  const limitPricePaise = type === "limit" ? parseRupeeInput(limitPrice) : null;
  const referencePricePaise = type === "limit" ? limitPricePaise : quote?.pricePaise ?? null;
  const hasValidQuantity = Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0;
  const estimatedNotional = hasValidQuantity && referencePricePaise !== null
    ? BigInt(parsedQuantity) * BigInt(referencePricePaise)
    : null;
  const estimateIsSafe = estimatedNotional !== null && estimatedNotional <= BigInt(Number.MAX_SAFE_INTEGER);
  const estimatedCostPaise = estimateIsSafe ? Number(estimatedNotional) : null;
  const feePaise = estimateIsSafe && referencePricePaise !== null
    ? estimatedFeePaise(referencePricePaise, parsedQuantity)
    : null;
  const buyingPowerPaise = portfolio.data === undefined
    ? null
    : portfolio.data.cashBalancePaise - portfolio.data.reservedBalancePaise;

  const order = useMutation({
    mutationFn: async () => {
      if (!hasValidQuantity || referencePricePaise === null || token === null) {
        throw new Error("Enter a valid quantity and wait for a live price before submitting.");
      }
      const input = OrderRequestSchema.parse({
        symbol,
        side,
        type,
        quantity: parsedQuantity,
        ...(type === "limit" && limitPricePaise !== null ? { limitPricePaise } : {})
      });
      const idempotencyKey = window.crypto.randomUUID();
      return apiRequest("/api/v1/orders", OrderResponseSchema, token, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(input)
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["risk"] }),
        queryClient.invalidateQueries({ queryKey: ["market", "depth", symbol] })
      ]);
    }
  });

  const orderError = order.error instanceof ApiClientError || order.error instanceof Error
    ? order.error.message
    : null;

  return (
    <section aria-labelledby="order-ticket-heading" className="workspace-panel market-ticket">
      <div className="market-panel-heading">
        <div><p className="workspace-eyebrow">Practice order</p><h2 id="order-ticket-heading">Order ticket</h2></div>
        <span className="market-shortcut-hint"><kbd>B</kbd> buy · <kbd>S</kbd> sell</span>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); order.mutate(); }}>
        <div aria-label="Order side" className="market-toggle-pair" role="group">
          <button aria-pressed={side === "buy"} className={side === "buy" ? "is-buy-selected" : ""} onClick={() => { sideRef.current = "buy"; setSide("buy"); }} type="button">BUY</button>
          <button aria-pressed={side === "sell"} className={side === "sell" ? "is-sell-selected" : ""} onClick={() => { sideRef.current = "sell"; setSide("sell"); }} type="button">SELL</button>
        </div>
        <div aria-label="Order type" className="market-toggle-pair market-type-toggle" role="group">
          <button aria-pressed={type === "market"} onClick={() => setType("market")} type="button">MARKET</button>
          <button aria-pressed={type === "limit"} onClick={() => setType("limit")} type="button">LIMIT</button>
        </div>
        <label className="market-ticket-field">
          Quantity
          <input aria-label="Order quantity" min="1" onChange={(event) => setQuantity(event.target.value)} step="1" type="number" value={quantity} />
        </label>
        {type === "limit" && (
          <label className="market-ticket-field">
            Limit price (₹)
            <input aria-label="Limit price in rupees" inputMode="decimal" min="0.01" onChange={(event) => setLimitPrice(event.target.value)} step="0.01" type="number" value={limitPrice} />
          </label>
        )}
        <dl className="market-order-estimate">
          <div><dt>Reference price</dt><dd>{quote === null ? "Unavailable" : formatPaise(quote.pricePaise)}</dd></div>
          <div><dt>Estimated cost</dt><dd>{estimatedCostPaise === null ? "—" : formatPaise(estimatedCostPaise)}</dd></div>
          <div><dt>Estimated fee</dt><dd>{feePaise === null ? "—" : formatPaise(feePaise)}</dd></div>
          <div><dt>Buying power</dt><dd>{buyingPowerPaise === null ? "Unavailable" : formatPaise(buyingPowerPaise)}</dd></div>
        </dl>
        {portfolio.error instanceof Error && <QueryMessage error>Buying power is unavailable: {portfolio.error.message}</QueryMessage>}
        {!estimateIsSafe && quote !== null && <QueryMessage error>Estimated order amount exceeds the supported range or has invalid inputs.</QueryMessage>}
        {orderError !== null && (
          <p className="market-order-feedback is-error" role="alert">
            {order.error instanceof ApiClientError && order.error.code === "RISK_REJECTED" ? `Risk rejected: ${orderError}` : orderError}
          </p>
        )}
        {order.data !== undefined && (
          <p className="market-order-feedback is-success" role="status">
            Order {order.data.status.replaceAll("_", " ")} · {order.data.quantity} {symbol} share(s) · {order.data.type.toUpperCase()}
          </p>
        )}
        <button
          className={`market-submit-order ${side === "buy" ? "is-buy-selected" : "is-sell-selected"}`}
          disabled={order.isPending || token === null || quote === null || !hasValidQuantity || !estimateIsSafe || (type === "limit" && limitPricePaise === null)}
          type="submit"
        >
          {order.isPending ? "Submitting…" : `${side.toUpperCase()} ${symbol}`}
        </button>
        <p className="market-ticket-disclaimer">Simulated orders use virtual funds. Fees are estimated at 0.03% per fill with a one-paise minimum.</p>
      </form>
    </section>
  );
}

function OrderBookDepth({ symbol }: { symbol: string }) {
  const { token } = useAuth();
  const depth = useQuery({
    queryKey: ["market", "depth", symbol],
    queryFn: () => apiRequest(`/api/market/${encodeURIComponent(symbol)}/depth`, MarketDepthResponseSchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 5_000
  });
  return (
    <section aria-labelledby="market-depth-heading" className="workspace-panel market-depth-panel">
      <div className="market-panel-heading"><div><p className="workspace-eyebrow">Open limit orders</p><h2 id="market-depth-heading">Order book depth</h2></div></div>
      {depth.isPending ? <QueryMessage>Loading order book…</QueryMessage> :
        depth.error instanceof Error ? <QueryMessage error>Order book depth is unavailable: {depth.error.message}</QueryMessage> :
          depth.data === undefined ? <QueryMessage error>Order book depth could not be loaded.</QueryMessage> : (
          <div className="market-depth-columns">
            <div>
              <h3 className="is-gain">Bids</h3>
              <div className="market-depth-header"><span>Price</span><span>Size</span><span>Orders</span></div>
              {depth.data.bids.length === 0 ? <p className="market-empty-depth">No open bids</p> :
                depth.data.bids.slice(0, 8).map((level) => <div className="market-depth-row is-bid" key={level.pricePaise}><span>{formatPaise(level.pricePaise)}</span><span>{level.quantity.toLocaleString("en-IN")}</span><span>{level.orderCount}</span></div>)}
            </div>
            <div>
              <h3 className="is-loss">Asks</h3>
              <div className="market-depth-header"><span>Price</span><span>Size</span><span>Orders</span></div>
              {depth.data.asks.length === 0 ? <p className="market-empty-depth">No open asks</p> :
                depth.data.asks.slice(0, 8).map((level) => <div className="market-depth-row is-ask" key={level.pricePaise}><span>{formatPaise(level.pricePaise)}</span><span>{level.quantity.toLocaleString("en-IN")}</span><span>{level.orderCount}</span></div>)}
            </div>
          </div>
        )}
    </section>
  );
}

export function MarketDetailPage() {
  const { symbol: pathSymbol } = useParams();
  const symbol = pathSymbol?.toUpperCase() ?? "";
  const { token } = useAuth();
  const [interval, setInterval] = useState<"1m" | "5m" | "15m" | "1h" | "4h" | "1d">("1d");
  const instruments = useQuery({
    queryKey: ["market", "instruments"],
    queryFn: () => apiRequest("/api/market/instruments", MarketInstrumentsResponseSchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 30_000
  });
  const quotes = useQuery({
    queryKey: ["quotes"],
    queryFn: () => apiRequest("/api/quotes", QuotesResponseSchema),
    refetchInterval: 5_000
  });
  const candles = useQuery({
    queryKey: ["market", "candles", symbol, interval],
    queryFn: () => apiRequest(`/api/market/${encodeURIComponent(symbol)}/candles?interval=${interval}&limit=200`, CandlesResponseSchema, token ?? undefined),
    enabled: token !== null && symbol.length > 0
  });
  const row = instruments.data?.instruments.find((item) => item.instrument.symbol === symbol);
  const quote = quotes.data?.quotes.find((item) => item.symbol === symbol) ?? row?.quote ?? null;
  const navigate = useNavigate();

  if (instruments.isPending) {
    return <div className="market-workspace"><QueryMessage>Loading instrument…</QueryMessage></div>;
  }
  if (instruments.error instanceof Error) {
    return <div className="market-workspace"><QueryMessage error>Instrument could not be loaded: {instruments.error.message}</QueryMessage></div>;
  }
  if (row === undefined) {
    return <div className="market-workspace"><QueryMessage error>Instrument {symbol || "unknown"} was not found.</QueryMessage><Link className="market-back-link" to="/app/markets">Back to markets</Link></div>;
  }

  const { instrument } = row;
  return (
    <div className="market-workspace">
      <button className="market-back-link" onClick={() => navigate("/app/markets")} type="button">← All markets</button>
      <header className="market-detail-heading">
        <div>
          <p className="workspace-eyebrow">{instrument.sector} · {instrument.symbol}</p>
          <h2>{instrument.name}</h2>
          <p>{instrument.symbol} · {quote === null ? "Live quote unavailable" : `Last price ${formatPaise(quote.pricePaise)}`}</p>
        </div>
        {quote !== null && <div className={`market-detail-price ${quote.changePaise >= 0 ? "is-gain" : "is-loss"}`}><strong>{formatPaise(quote.pricePaise)}</strong><span>{quote.changePaise > 0 ? "+" : ""}{formatPaise(quote.changePaise)}</span></div>}
      </header>

      <div className="market-detail-grid">
        <section aria-labelledby="market-chart-heading" className="workspace-panel market-chart-panel">
          <div className="market-panel-heading">
            <div><p className="workspace-eyebrow">Historical prices</p><h2 id="market-chart-heading">Price chart</h2></div>
            <label className="market-interval-select"><span>Chart interval</span>
              <select aria-label="Chart interval" onChange={(event) => setInterval(event.target.value as typeof interval)} value={interval}>
                {(["1m", "5m", "15m", "1h", "4h", "1d"] as const).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
          {candles.isPending ? <QueryMessage>Loading candle data…</QueryMessage> :
            candles.error instanceof Error ? <QueryMessage error>Candles could not be loaded: {candles.error.message}</QueryMessage> :
              candles.data === undefined ? <QueryMessage error>Candle data could not be loaded.</QueryMessage> : (
              <>
                <CandlestickChart candles={candles.data.candles} />
                {candles.data.candles.length === 0 && <p className="market-chart-empty">No candle history is available for this interval.</p>}
              </>
            )}
        </section>
        <OrderTicket key={instrument.symbol} quote={quote} symbol={instrument.symbol} />
        <OrderBookDepth symbol={instrument.symbol} />
      </div>
    </div>
  );
}

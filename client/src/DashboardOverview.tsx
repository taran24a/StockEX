import {
  AiExplainResponseSchema,
  AccountPortfolioResponseSchema,
  PaginatedOrdersResponseSchema,
  PortfolioPerformanceResponseSchema,
  QuotesResponseSchema,
  RiskAlertsResponseSchema,
  RiskRulesSchema,
  RiskSummarySchema,
  WatchlistsResponseSchema,
  type RiskAlert
} from "@tradewise/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "./api";
import { useAuth } from "./auth";
import { LivePriceChart, type PricePoint } from "./LivePriceChart";
import { formatPaise } from "./format";

function ErrorState({ message }: { message: string }) {
  return <p className="workspace-error" role="alert">{message}</p>;
}

function PanelSkeleton({ label }: { label: string }) {
  return (
    <div aria-label={label} className="workspace-panel-skeleton" role="status">
      <span className="sr-only">{label}…</span>
      <span />
      <span />
      <span />
    </div>
  );
}

function PanelState({
  loading,
  error,
  empty,
  emptyMessage = "No data available yet.",
  children
}: {
  loading: boolean;
  error: Error | null;
  empty: boolean;
  emptyMessage?: string;
  children: ReactNode;
}) {
  if (loading) {
    return <PanelSkeleton label="Loading account data" />;
  }
  if (error !== null) {
    return <ErrorState message={error.message} />;
  }
  if (empty) {
    return <p className="workspace-panel-state">{emptyMessage}</p>;
  }
  return children;
}

function Metric({
  label,
  value,
  loading,
  error,
  tone
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  error: Error | null;
  tone?: "gain" | "loss";
}) {
  return (
    <article className="workspace-metric">
      <p className="workspace-eyebrow">{label}</p>
      {loading ? (
        <div aria-label={`Loading ${label.toLowerCase()}`} className="workspace-metric-skeleton" role="status" />
      ) : error !== null ? (
        <p className="workspace-metric-unavailable">Unavailable</p>
      ) : value === undefined ? (
        <p className="workspace-metric-unavailable">No account data</p>
      ) : (
        <p className={`workspace-metric-value ${tone === undefined ? "" : `is-${tone}`}`}>
          {tone === undefined ? formatPaise(value) : <ChangeValue value={value} />}
        </p>
      )}
    </article>
  );
}

function ChangeValue({ value }: { value: number }) {
  return (
    <span className={value > 0 ? "is-gain" : value < 0 ? "is-loss" : "is-neutral"}>
      {value > 0 ? "+" : ""}{formatPaise(value)}
    </span>
  );
}

function EmptyEquityState() {
  return (
    <div className="workspace-equity-empty">
      <svg aria-hidden="true" viewBox="0 0 640 160" preserveAspectRatio="none">
        <path d="M0 30.5h640M0 70.5h640M0 110.5h640M0 150.5h640" />
        <path className="workspace-equity-empty-axis" d="M0 150.5h640" />
      </svg>
      <div className="workspace-equity-empty-copy">
        <span aria-hidden="true">↗</span>
        <strong>Your equity history starts here</strong>
        <p>Portfolio snapshots will appear as your practice account grows.</p>
        <Link className="workspace-subtle-link" to="/app/markets">Explore markets <span aria-hidden="true">→</span></Link>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function HoldingsPanel() {
  const { token } = useAuth();
  const portfolio = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => apiRequest("/api/v1/portfolio", AccountPortfolioResponseSchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 15_000
  });
  const holdings = portfolio.data?.holdings ?? [];

  return (
    <section aria-labelledby="holdings-heading" className="workspace-panel">
      <div className="workspace-panel-heading">
        <div>
          <p className="workspace-eyebrow">Portfolio</p>
          <h2 id="holdings-heading">Live holdings</h2>
        </div>
        <Link className="workspace-subtle-link" to="/app/portfolio">View portfolio</Link>
      </div>
      <PanelState
        loading={portfolio.isPending}
        error={portfolio.error}
        empty={portfolio.data !== undefined && holdings.length === 0}
        emptyMessage="No open positions yet."
      >
        <p className="workspace-scroll-hint">Swipe or scroll horizontally to see all columns</p>
        <div aria-label="Scrollable holdings table" className="workspace-table-wrap" role="region" tabIndex={0}>
          <table className="workspace-table">
            <caption className="sr-only">Current account holdings, market value, and unrealized profit or loss</caption>
            <thead><tr><th scope="col">Instrument</th><th scope="col">Shares</th><th scope="col">Market price</th><th scope="col">Market value</th><th scope="col">Unrealized P&amp;L</th></tr></thead>
            <tbody>
              {holdings.map((holding) => (
                <tr key={holding.instrumentId}>
                  <th scope="row"><span className="workspace-symbol">{holding.symbol}</span></th>
                  <td>{holding.quantity.toLocaleString("en-IN")}</td>
                  <td>{formatPaise(holding.marketPricePaise)}</td>
                  <td>{formatPaise(holding.marketValuePaise)}</td>
                  <td><ChangeValue value={holding.unrealizedPnlPaise} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelState>
    </section>
  );
}

function WatchlistPanel() {
  const { token } = useAuth();
  const watchlists = useQuery({
    queryKey: ["watchlists"],
    queryFn: () => apiRequest("/api/watchlists", WatchlistsResponseSchema, token ?? undefined),
    enabled: token !== null
  });
  const quotes = useQuery({
    queryKey: ["quotes"],
    queryFn: () => apiRequest("/api/quotes", QuotesResponseSchema),
    refetchInterval: 10_000
  });
  const quoteBySymbol = new Map((quotes.data?.quotes ?? []).map((quote) => [quote.symbol, quote]));
  const items = (watchlists.data?.watchlists ?? []).flatMap((list) =>
    list.instruments.map((instrument) => ({ ...instrument, watchlistName: list.name, quote: quoteBySymbol.get(instrument.symbol) }))
  );

  return (
    <section aria-labelledby="watchlist-heading" className="workspace-panel">
      <div className="workspace-panel-heading">
        <div>
          <p className="workspace-eyebrow">Keep an eye on</p>
          <h2 id="watchlist-heading">Your watchlist</h2>
        </div>
        <Link className="workspace-subtle-link" to="/app/markets">Markets</Link>
      </div>
      {watchlists.isPending ? <PanelSkeleton label="Loading watchlists" /> :
        watchlists.error instanceof Error ? <ErrorState message={watchlists.error.message} /> :
          watchlists.data?.watchlists.length === 0 ? <p className="workspace-panel-state">You haven’t created a watchlist yet. Visit Markets to explore live quotes.</p> :
            quotes.isPending ? <PanelSkeleton label="Loading live quotes" /> :
              quotes.error instanceof Error ? <ErrorState message={`Live quotes could not be loaded: ${quotes.error.message}`} /> :
                items.length === 0 ? <p className="workspace-panel-state">Your watchlists don’t have any instruments yet.</p> : (
                  <ul className="workspace-watchlist">
                    {items.map((instrument, index) => (
                      <li key={`${instrument.symbol}-${index}`}>
                        <div>
                          <strong>{instrument.symbol}</strong>
                          <span>{instrument.name}</span>
                        </div>
                        <div className="workspace-watchlist-price">
                          {instrument.quote === undefined ? (
                            <span className="workspace-muted">Quote unavailable</span>
                          ) : (
                            <>
                              <strong>{formatPaise(instrument.quote.pricePaise)}</strong>
                              <small><ChangeValue value={instrument.quote.changePaise} /></small>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
    </section>
  );
}

function OrdersPanel() {
  const { token } = useAuth();
  const orders = useQuery({
    queryKey: ["orders", "dashboard", 5, 0],
    queryFn: () => apiRequest("/api/v1/orders?limit=5&offset=0", PaginatedOrdersResponseSchema, token ?? undefined),
    enabled: token !== null
  });
  const recentOrders = orders.data?.orders ?? [];

  return (
    <section aria-labelledby="orders-heading" className="workspace-panel">
      <div className="workspace-panel-heading">
        <div>
          <p className="workspace-eyebrow">Latest activity</p>
          <h2 id="orders-heading">Recent orders</h2>
        </div>
        <Link className="workspace-subtle-link" to="/app/orders">All orders</Link>
      </div>
      <PanelState
        loading={orders.isPending}
        error={orders.error}
        empty={orders.data !== undefined && recentOrders.length === 0}
        emptyMessage="No orders on this page."
      >
        <p className="workspace-scroll-hint">Swipe or scroll horizontally to see all columns</p>
        <div aria-label="Scrollable recent orders table" className="workspace-table-wrap" role="region" tabIndex={0}>
          <table className="workspace-table">
            <caption className="sr-only">Most recent account orders</caption>
            <thead><tr><th scope="col">Order</th><th scope="col">Type</th><th scope="col">Filled</th><th scope="col">Status</th><th scope="col">Placed</th></tr></thead>
            <tbody>
              {recentOrders.map((order) => (
                <tr key={order.id}>
                  <th scope="row">
                    <span className={order.side === "buy" ? "workspace-side-buy" : "workspace-side-sell"}>{order.side.toUpperCase()}</span>
                    <span className="workspace-symbol"> {order.symbol}</span>
                  </th>
                  <td className="capitalize">{order.type}</td>
                  <td>{order.filledQuantity} / {order.quantity}</td>
                  <td><span className="workspace-order-status">{order.status.replaceAll("_", " ")}</span></td>
                  <td>{formatDate(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelState>
    </section>
  );
}

export function PortfolioExplanationPanel() {
  const { token } = useAuth();
  const explanation = useMutation({
    mutationFn: () => apiRequest("/api/ai/explain", AiExplainResponseSchema, token ?? undefined, {
      method: "POST"
    })
  });

  return (
    <section aria-labelledby="portfolio-explanation-heading" className="workspace-panel workspace-ai-explanation">
      <div className="workspace-panel-heading">
        <div>
          <p className="workspace-eyebrow">Portfolio insights</p>
          <h2 id="portfolio-explanation-heading">Explain my portfolio</h2>
        </div>
        {explanation.data !== undefined && (
          <span className="workspace-ai-source">{explanation.data.source === "ollama" ? "Local AI" : "Data summary"}</span>
        )}
      </div>
      <p className="workspace-ai-disclaimer">A factual summary of your portfolio metrics. It does not place or approve orders and is not financial advice.</p>
      {explanation.error instanceof Error ? (
        <p className="workspace-error" role="alert">Portfolio explanation could not be generated: {explanation.error.message}</p>
      ) : explanation.data !== undefined ? (
        <>
          <p className="workspace-ai-summary">{explanation.data.explanation}</p>
          <ul className="workspace-ai-highlights">
            {explanation.data.highlights.map((highlight, index) => <li key={`${index}-${highlight}`}>{highlight}</li>)}
          </ul>
          <p className="workspace-ai-generated">Updated {formatDate(explanation.data.generatedAt)}</p>
        </>
      ) : (
        <p className="workspace-panel-state">Generate a numeric summary of current equity, return, P&amp;L, and holding contributions.</p>
      )}
      <button
        className="workspace-button"
        disabled={token === null || explanation.isPending}
        onClick={() => explanation.mutate()}
        type="button"
      >{explanation.isPending ? "Preparing explanation…" : "Explain my portfolio"}</button>
    </section>
  );
}

function RiskPanel() {
  const { token } = useAuth();
  const risk = useQuery({
    queryKey: ["risk", "summary"],
    queryFn: () => apiRequest("/api/v1/risk/summary", RiskSummarySchema, token ?? undefined),
    enabled: token !== null
  });
  const alerts = useQuery({
    queryKey: ["risk", "alerts", 5, 0],
    queryFn: () => apiRequest("/api/v1/risk/alerts?limit=5&offset=0", RiskAlertsResponseSchema, token ?? undefined),
    enabled: token !== null
  });
  const rules = useQuery({
    queryKey: ["risk", "rules"],
    queryFn: () => apiRequest("/api/v1/risk/rules", RiskRulesSchema, token ?? undefined),
    enabled: token !== null
  });
  const alertItems: RiskAlert[] = alerts.data?.alerts ?? [];
  const concentrations = [...(risk.data?.singleStocks ?? []).map((item) => ({ ...item, kind: "Stock" })),
    ...(risk.data?.sectors ?? []).map((item) => ({ ...item, kind: "Sector" }))]
    .sort((left, right) => right.concentrationPct - left.concentrationPct)
    .slice(0, 5);
  const aboveLimitCount = risk.data?.warnings.length ?? 0;
  const nearLimit = risk.data !== undefined && rules.data !== undefined && concentrations.some((item) => {
    const limit = item.kind === "Stock" ? rules.data.maxSingleStockConcentrationPct : rules.data.maxSectorConcentrationPct;
    return item.concentrationPct >= limit * 0.8 && item.concentrationPct <= limit;
  });
  const riskStatus = aboveLimitCount > 0 ? "is-critical" : nearLimit ? "is-warning" : "is-clear";

  return (
    <section aria-labelledby="risk-heading" className="workspace-panel">
      <div className="workspace-panel-heading">
        <div>
          <p className="workspace-eyebrow">Exposure &amp; guardrails</p>
          <h2 id="risk-heading">Risk summary</h2>
        </div>
        <Link className="workspace-subtle-link" to="/app/risk">Risk details</Link>
      </div>
      {risk.isPending || rules.isPending ? <PanelSkeleton label="Loading risk summary" /> :
        risk.error instanceof Error ? <ErrorState message={risk.error.message} /> :
          rules.error instanceof Error ? <ErrorState message={`Risk limits could not be loaded: ${rules.error.message}`} /> :
            risk.data === undefined || rules.data === undefined ? <p className="workspace-panel-state">Risk data is unavailable.</p> : (
              <>
                <div className={`workspace-risk-status ${riskStatus}`} role="status">
                  <span aria-hidden="true" />
                  <div>
                    <strong>{aboveLimitCount > 0 ? "Limit exceeded" : nearLimit ? "Approaching a limit" : "Within your limits"}</strong>
                    <p>{aboveLimitCount > 0
                      ? `${aboveLimitCount} concentration warning${aboveLimitCount === 1 ? "" : "s"} need review.`
                      : nearLimit
                        ? "An exposure is within 20% of its configured limit."
                        : "No stock or sector concentration limits are currently exceeded."}</p>
                  </div>
                </div>
                {risk.data.warnings.length > 0 && <ul className="workspace-warning-list">{risk.data.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>}
                <div className="workspace-risk-section-heading">
                  <span>Top exposures</span>
                  <Link className="workspace-subtle-link" to="/app/risk">Limits &amp; alerts</Link>
                </div>
                {concentrations.length === 0 ? (
                  <p className="workspace-panel-state">No open positions yet.</p>
                ) : (
                  <ul className="workspace-concentration">
                    {concentrations.map((item) => {
                      const limit = item.kind === "Stock" ? rules.data.maxSingleStockConcentrationPct : rules.data.maxSectorConcentrationPct;
                      const tone = item.concentrationPct > limit ? "is-critical" : item.concentrationPct >= limit * 0.8 ? "is-warning" : "is-clear";
                      return (
                        <li key={`${item.kind}-${item.name}`}>
                          <div className="workspace-concentration-label"><span>{item.kind} · {item.name}</span><strong>{item.concentrationPct.toFixed(1)}% <small>of {limit}%</small></strong></div>
                          <div aria-label={`${item.kind} ${item.name} concentration ${item.concentrationPct.toFixed(1)} percent, limit ${limit} percent`} className={`workspace-meter ${tone}`} role="meter" aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.min(item.concentrationPct, 100)} aria-valuetext={`${item.concentrationPct.toFixed(1)} percent of equity; limit ${limit} percent`}>
                            <span style={{ width: `${Math.min(item.concentrationPct, 100)}%` }} />
                            <i aria-hidden="true" style={{ left: `${limit}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="workspace-alert-summary">
                  <span>Recent risk alerts</span>
                  {alerts.isPending ? <span role="status">Loading…</span> :
                    alerts.error instanceof Error ? <span className="is-loss">Alerts unavailable</span> :
                      alertItems.length === 0 ? <span>No alerts</span> :
                        <span>{alertItems.filter((alert) => alert.acknowledgedAt === null).length} unacknowledged · {alertItems.length} shown</span>}
                </div>
                {!alerts.isPending && alerts.error instanceof Error && <ErrorState message={alerts.error.message} />}
                {!alerts.isPending && alerts.error === null && alertItems.length > 0 && (
                  <ul className="workspace-risk-alerts">
                    {alertItems.slice(0, 3).map((alert) => (
                      <li key={alert.id}><span className={`workspace-severity is-${alert.severity}`} />{alert.message}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
    </section>
  );
}

function AccountGuardrailsPanel() {
  const { token } = useAuth();
  const rules = useQuery({
    queryKey: ["risk", "rules"],
    queryFn: () => apiRequest("/api/v1/risk/rules", RiskRulesSchema, token ?? undefined),
    enabled: token !== null
  });
  const risk = useQuery({
    queryKey: ["risk", "summary"],
    queryFn: () => apiRequest("/api/v1/risk/summary", RiskSummarySchema, token ?? undefined),
    enabled: token !== null
  });

  const largestStockPct = Math.max(0, ...(risk.data?.singleStocks ?? []).map((item) => item.concentrationPct));
  const largestSectorPct = Math.max(0, ...(risk.data?.sectors ?? []).map((item) => item.concentrationPct));

  function limitRow(label: string, currentPct: number, limitPct: number) {
    const usagePct = Math.min(100, currentPct / limitPct * 100);
    const tone = currentPct > limitPct ? "is-critical" : currentPct >= limitPct * 0.8 ? "is-warning" : "is-clear";
    return (
      <li key={label}>
        <div className="workspace-guardrail-label"><span>{label}</span><strong>{currentPct.toFixed(1)}% <small>of {limitPct}%</small></strong></div>
        <div className={`workspace-meter ${tone}`} role="meter" aria-label={`${label}: ${currentPct.toFixed(1)} percent of ${limitPct} percent limit`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(currentPct, 100)}>
          <span style={{ width: `${usagePct}%` }} />
        </div>
      </li>
    );
  }

  return (
    <section aria-labelledby="guardrails-heading" className="workspace-panel workspace-guardrails-panel">
      <div className="workspace-panel-heading">
        <div>
          <p className="workspace-eyebrow">Account protection</p>
          <h2 id="guardrails-heading">Your guardrails</h2>
        </div>
        <Link className="workspace-subtle-link" to="/app/risk">Edit limits</Link>
      </div>
      {rules.isPending || risk.isPending ? <PanelSkeleton label="Loading account guardrails" /> :
        rules.error instanceof Error ? <ErrorState message={`Risk limits could not be loaded: ${rules.error.message}`} /> :
          risk.error instanceof Error ? <ErrorState message={`Current exposures could not be loaded: ${risk.error.message}`} /> :
            rules.data === undefined || risk.data === undefined ? <p className="workspace-panel-state">Account guardrails are unavailable.</p> : (
              <>
                <div className="workspace-order-cap">
                  <span>Maximum order size</span>
                  <strong>{formatPaise(rules.data.maxOrderNotionalPaise)}</strong>
                </div>
                <div className="workspace-guardrail-section-title">Concentration limits</div>
                <ul className="workspace-guardrail-list">
                  {limitRow("Single stock", largestStockPct, rules.data.maxSingleStockConcentrationPct)}
                  {limitRow("Single sector", largestSectorPct, rules.data.maxSectorConcentrationPct)}
                </ul>
                <p className="workspace-guardrail-note">Current exposure is measured against your account limits.</p>
              </>
            )}
    </section>
  );
}

function MarketPulsePanel() {
  const quotes = useQuery({
    queryKey: ["quotes"],
    queryFn: () => apiRequest("/api/quotes", QuotesResponseSchema),
    refetchInterval: 10_000
  });
  const marketQuotes = quotes.data?.quotes ?? [];
  const advancing = marketQuotes.filter((quote) => quote.changePaise > 0).length;
  const declining = marketQuotes.filter((quote) => quote.changePaise < 0).length;
  const unchanged = marketQuotes.length - advancing - declining;
  const movers = [...marketQuotes]
    .sort((left, right) => {
      const leftPct = left.changePaise / Math.max(1, left.pricePaise - left.changePaise);
      const rightPct = right.changePaise / Math.max(1, right.pricePaise - right.changePaise);
      return Math.abs(rightPct) - Math.abs(leftPct);
    })
    .slice(0, 3);

  return (
    <section aria-labelledby="market-pulse-heading" className="workspace-panel workspace-market-pulse">
      <div className="workspace-panel-heading">
        <div>
          <p className="workspace-eyebrow">Live market snapshot</p>
          <h2 id="market-pulse-heading">Market pulse</h2>
        </div>
        <Link className="workspace-subtle-link" to="/app/markets">Explore markets</Link>
      </div>
      {quotes.isPending ? <PanelSkeleton label="Loading market pulse" /> :
        quotes.error instanceof Error ? <ErrorState message={`Market quotes could not be loaded: ${quotes.error.message}`} /> :
          marketQuotes.length === 0 ? <p className="workspace-panel-state">Market quotes are not available right now.</p> : (
            <>
              <div aria-label={`Market breadth: ${advancing} advancing, ${declining} declining, ${unchanged} unchanged`} className="workspace-market-breadth">
                <div><strong>{marketQuotes.length}</strong><span>instruments</span></div>
                <span className="is-gain">{advancing} up</span>
                <span className="is-loss">{declining} down</span>
                {unchanged > 0 && <span className="is-flat">{unchanged} flat</span>}
              </div>
              <div className="workspace-market-movers-heading"><span>Biggest movers</span><span>Last price · change</span></div>
              <ul className="workspace-market-movers">
                {movers.map((quote) => {
                  const previousPricePaise = Math.max(1, quote.pricePaise - quote.changePaise);
                  const changePct = quote.changePaise / previousPricePaise * 100;
                  const tone = changePct > 0 ? "is-gain" : changePct < 0 ? "is-loss" : "is-flat";
                  return (
                    <li key={quote.symbol}>
                      <Link aria-label={`View ${quote.symbol} market details`} to={`/app/markets/${encodeURIComponent(quote.symbol)}`}><strong>{quote.symbol}</strong></Link>
                      <span>{formatPaise(quote.pricePaise)}</span>
                      <strong className={tone}>{changePct > 0 ? "+" : ""}{changePct.toFixed(2)}%</strong>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
    </section>
  );
}

export function DashboardOverview() {
  const { token, user } = useAuth();
  const portfolio = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => apiRequest("/api/v1/portfolio", AccountPortfolioResponseSchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 15_000
  });
  const performance = useQuery({
    queryKey: ["portfolio", "performance"],
    queryFn: () => apiRequest("/api/v1/portfolio/performance", PortfolioPerformanceResponseSchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 30_000
  });
  const curve: PricePoint[] = (performance.data?.equityCurve ?? []).map((point) => ({
    time: Math.floor(Date.parse(point.timestamp) / 1_000) as PricePoint["time"],
    value: point.equityPaise
  }));
  const dayChange = performance.data?.dayChangePaise;
  const unrealized = performance.data?.unrealizedPnlPaise;
  const performanceError = performance.error instanceof Error ? performance.error : null;
  const portfolioError = portfolio.error instanceof Error ? portfolio.error : null;
  const chartSummary = curve.length === 0
    ? "No equity snapshots have been recorded yet."
    : `Equity history from ${formatDate(performance.data?.equityCurve[0]?.timestamp ?? "")} through ${formatDate(performance.data?.equityCurve.at(-1)?.timestamp ?? "")}, ${curve.length} snapshots.`;
  const investedPaise = portfolio.data?.holdings.reduce((sum, holding) => sum + holding.marketValuePaise, 0);
  const allocationBasePaise = portfolio.data === undefined || investedPaise === undefined
    ? 0
    : portfolio.data.cashBalancePaise + investedPaise;
  const cashSharePct = allocationBasePaise > 0 && portfolio.data !== undefined
    ? portfolio.data.cashBalancePaise / allocationBasePaise * 100
    : 0;
  const investedSharePct = allocationBasePaise > 0 ? 100 - cashSharePct : 0;
  const firstName = user?.displayName.trim().split(/\s+/)[0] ?? "Trader";

  return (
    <div className="workspace-dashboard">
      <section aria-labelledby="dashboard-welcome-heading" className="workspace-dashboard-welcome">
        <div>
          <p className="workspace-eyebrow">Your trading desk</p>
          <h2 id="dashboard-welcome-heading">Welcome back, {firstName}</h2>
          <p>Track your virtual portfolio, review recent activity, and explore the market.</p>
        </div>
        <Link className="workspace-button-link workspace-dashboard-market-link" to="/app/markets">
          Explore markets <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <section aria-label="Portfolio metrics" className="workspace-metrics">
        <Metric label="Total equity" value={portfolio.data?.totalEquityPaise} loading={portfolio.isPending} error={portfolioError} />
        <Metric label="Cash balance" value={portfolio.data?.cashBalancePaise} loading={portfolio.isPending} error={portfolioError} />
        <Metric label="Day P&L" value={dayChange} loading={performance.isPending} error={performanceError} tone={dayChange === undefined ? undefined : dayChange >= 0 ? "gain" : "loss"} />
        <Metric label="Unrealized P&L" value={unrealized} loading={performance.isPending} error={performanceError} tone={unrealized === undefined ? undefined : unrealized >= 0 ? "gain" : "loss"} />
      </section>
      <PortfolioExplanationPanel />

      <section aria-labelledby="allocation-heading" className="workspace-panel workspace-allocation-panel">
        <div className="workspace-allocation-intro">
          <p className="workspace-eyebrow">At a glance</p>
          <h2 id="allocation-heading">Capital allocation</h2>
          <p>A live split of account cash and the current market value of your holdings.</p>
        </div>
        {portfolio.isPending ? (
          <PanelSkeleton label="Loading capital allocation" />
        ) : portfolioError !== null ? (
          <ErrorState message={portfolioError.message} />
        ) : portfolio.data === undefined ? (
          <p className="workspace-panel-state">Capital allocation is unavailable.</p>
        ) : allocationBasePaise === 0 ? (
          <p className="workspace-panel-state">No account value is available to allocate yet.</p>
        ) : (
          <>
            <div
              aria-label={`Capital allocation: cash ${cashSharePct.toFixed(1)} percent, holdings ${investedSharePct.toFixed(1)} percent`}
              className="workspace-allocation-ring"
              role="img"
              style={{ "--cash-share": `${cashSharePct}%` } as CSSProperties}
            >
              <div>
                <span>Account value</span>
                <strong>{formatPaise(allocationBasePaise)}</strong>
              </div>
            </div>
            <ul className="workspace-allocation-legend">
              <li>
                <span className="workspace-allocation-key is-cash" />
                <span>Cash balance</span>
                <strong>{formatPaise(portfolio.data.cashBalancePaise)}</strong>
                <small>{cashSharePct.toFixed(1)}%</small>
              </li>
              <li>
                <span className="workspace-allocation-key is-invested" />
                <span>Holdings market value</span>
                <strong>{formatPaise(investedPaise ?? 0)}</strong>
                <small>{investedSharePct.toFixed(1)}%</small>
              </li>
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="equity-heading" className="workspace-panel workspace-equity-panel">
        <div className="workspace-panel-heading">
          <div>
            <p className="workspace-eyebrow">Account performance</p>
            <h2 id="equity-heading">Equity curve</h2>
          </div>
          {performance.data !== undefined && <p className="workspace-chart-current">Now <strong>{portfolio.data === undefined ? "—" : formatPaise(portfolio.data.totalEquityPaise)}</strong></p>}
        </div>
        {performance.isPending ? <PanelSkeleton label="Loading equity history" /> :
          performanceError !== null ? <ErrorState message={performanceError.message} /> :
            curve.length === 0 ? <EmptyEquityState /> : (
              <>
                <LivePriceChart data={curve} ariaLabel={`Portfolio equity curve. ${chartSummary}`} />
                <p className="sr-only">{chartSummary}</p>
              </>
            )}
      </section>

      <div className="workspace-dashboard-columns">
        <div className="workspace-dashboard-primary">
          <HoldingsPanel />
          <OrdersPanel />
          <MarketPulsePanel />
        </div>
        <aside className="workspace-dashboard-secondary" aria-label="Watchlist and risk information">
          <WatchlistPanel />
          <RiskPanel />
          <AccountGuardrailsPanel />
        </aside>
      </div>
      <p className="workspace-disclaimer">Practice with virtual money only. Market data may be delayed. This workspace is for learning, not financial advice.</p>
    </div>
  );
}

export function WorkspaceStub({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="workspace-panel workspace-stub">
      <p className="workspace-eyebrow">Workspace</p>
      <h2>{title}</h2>
      <p>{detail}</p>
      <Link className="workspace-button-link" to="/app/dashboard">Return to dashboard</Link>
    </section>
  );
}

export function ProfileStub() {
  const { user, avatarUrl, uploadAvatar } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  async function updateAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) {
      return;
    }
    try {
      await uploadAvatar(file);
      setMessage("Profile image updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile image could not be updated.");
    }
  }

  return (
    <section className="workspace-panel workspace-stub">
      <p className="workspace-eyebrow">Account</p>
      <h2>Profile</h2>
      <p>{user?.displayName} · {user?.email}</p>
      <div className="workspace-profile-row">
        {avatarUrl === null
          ? <span aria-hidden="true" className="workspace-avatar">{user?.displayName.slice(0, 1).toUpperCase()}</span>
          : <img alt="" className="workspace-avatar" src={avatarUrl} />}
        <label className="workspace-button-link">
          Update profile image
          <input accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => void updateAvatar(event)} type="file" />
        </label>
      </div>
      {message !== null && <p role="status">{message}</p>}
      <p className="workspace-muted">Additional profile settings are not available yet.</p>
    </section>
  );
}

import {
  AccountPortfolioResponseSchema,
  PaginatedLedgerResponseSchema,
  PortfolioPerformanceResponseSchema,
  PortfolioVerifyResponseSchema,
  RiskSummarySchema,
  type AccountHolding,
  type LedgerEntry,
  type RiskSummary
} from "@tradewise/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { apiRequest } from "./api";
import { useAuth } from "./auth";
import { formatPaise } from "./format";
import { DataTable, type DataTableColumn } from "./components/ui";

const ledgerPageSize = 20;
const colors = ["#86d5a0", "#70b6bd", "#b5a1e8", "#e5bc77", "#df8b91", "#85a7d6", "#9fb77b"];

function PortfolioMessage({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`portfolio-message ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{children}</p>;
}

function HoldingTable({ holdings }: { holdings: AccountHolding[] }) {
  return (
    <div className="portfolio-table-scroll">
      <table className="portfolio-table">
        <caption className="sr-only">Portfolio holdings with market value and unrealized profit or loss</caption>
        <thead>
          <tr><th scope="col">Instrument</th><th scope="col">Quantity</th><th scope="col">Average cost</th><th scope="col">Market price</th><th scope="col">Market value</th><th scope="col">Unrealized P&amp;L</th></tr>
        </thead>
        <tbody>
          {holdings.map((holding) => (
            <tr key={holding.instrumentId}>
              <th scope="row"><span className="portfolio-symbol">{holding.symbol}</span></th>
              <td>{holding.quantity.toLocaleString("en-IN")}</td>
              <td>{formatPaise(holding.averageCostPaise)}</td>
              <td>{formatPaise(holding.marketPricePaise)}</td>
              <td>{formatPaise(holding.marketValuePaise)}</td>
              <td className={holding.unrealizedPnlPaise > 0 ? "is-gain" : holding.unrealizedPnlPaise < 0 ? "is-loss" : ""}>
                {holding.unrealizedPnlPaise > 0 ? "+" : ""}{formatPaise(holding.unrealizedPnlPaise)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AllocationDonut({
  title,
  description,
  entries
}: {
  title: string;
  description: string;
  entries: Array<{ name: string; marketValuePaise: number; concentrationPct: number }>;
}) {
  const positiveEntries = entries.filter((entry) => entry.marketValuePaise > 0);
  const total = positiveEntries.reduce((sum, entry) => sum + entry.marketValuePaise, 0);
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <section aria-label={title} className="portfolio-allocation-card">
      <div>
        <p className="workspace-eyebrow">{description}</p>
        <h3>{title}</h3>
      </div>
      {total === 0 ? (
        <p className="portfolio-empty">No invested holdings to allocate yet.</p>
      ) : (
        <div className="portfolio-allocation-content">
          <svg aria-label={`${title} allocation donut`} className="portfolio-donut" role="img" viewBox="0 0 140 140">
            <circle cx="70" cy="70" fill="none" r={radius} stroke="#26343d" strokeWidth="15" />
            {positiveEntries.map((entry, index) => {
              const length = circumference * entry.marketValuePaise / total;
              const circle = (
                <circle
                  className="portfolio-donut-segment"
                  cx="70"
                  cy="70"
                  fill="none"
                  key={entry.name}
                  r={radius}
                  stroke={colors[index % colors.length]}
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={-offset}
                  strokeWidth="15"
                  transform="rotate(-90 70 70)"
                />
              );
              offset += length;
              return circle;
            })}
            <text className="portfolio-donut-total" textAnchor="middle" x="70" y="68">{formatPaise(total)}</text>
            <text className="portfolio-donut-caption" textAnchor="middle" x="70" y="84">invested</text>
          </svg>
          <ul className="portfolio-allocation-legend">
            {positiveEntries.map((entry, index) => (
              <li key={entry.name}>
                <span aria-hidden="true" style={{ backgroundColor: colors[index % colors.length] }} />
                <strong>{entry.name}</strong>
                <small>{entry.concentrationPct.toFixed(1)}%</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function allocationEntries(
  items: RiskSummary["sectors"] | undefined
): Array<{ name: string; marketValuePaise: number; concentrationPct: number }> {
  const total = (items ?? []).reduce((sum, item) => sum + item.marketValuePaise, 0);
  return (items ?? []).map((item) => ({
    name: item.name,
    marketValuePaise: item.marketValuePaise,
    concentrationPct: total === 0 ? 0 : item.marketValuePaise / total * 100
  }));
}

function LedgerSection() {
  const { token } = useAuth();
  const [page, setPage] = useState(0);
  const ledger = useQuery({
    queryKey: ["portfolio", "ledger", page],
    queryFn: () => apiRequest(
      `/api/v1/ledger?limit=${ledgerPageSize}&offset=${page * ledgerPageSize}`,
      PaginatedLedgerResponseSchema,
      token ?? undefined
    ),
    enabled: token !== null
  });
  const columns: DataTableColumn<LedgerEntry>[] = [
    {
      key: "createdAt",
      header: "Date",
      sortable: true,
      value: (entry) => Date.parse(entry.createdAt),
      render: (entry) => <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
    },
    { key: "type", header: "Entry", sortable: true, value: (entry) => entry.entryType, render: (entry) => entry.entryType.replaceAll("_", " ") },
    { key: "fill", header: "Fill", render: (entry) => entry.fillId === null ? "—" : `${entry.fillId.slice(0, 8)}…` },
    {
      key: "amount",
      header: "Amount",
      sortable: true,
      value: (entry) => entry.amountPaise,
      render: (entry) => <span className={entry.amountPaise > 0 ? "is-gain" : "is-loss"}>{entry.amountPaise > 0 ? "+" : ""}{formatPaise(entry.amountPaise)}</span>
    },
    { key: "balance", header: "Balance after", sortable: true, value: (entry) => entry.balanceAfterPaise, render: (entry) => formatPaise(entry.balanceAfterPaise) }
  ];

  if (ledger.isPending) return <PortfolioMessage>Loading ledger…</PortfolioMessage>;
  if (ledger.error instanceof Error) return <PortfolioMessage error>Ledger could not be loaded: {ledger.error.message}</PortfolioMessage>;
  if (ledger.data === undefined) return <PortfolioMessage error>Ledger data is unavailable.</PortfolioMessage>;

  return (
    <DataTable
      columns={columns}
      data={ledger.data.entries}
      emptyDescription="Ledger entries will appear here as portfolio activity is recorded."
      emptyTitle="No ledger entries"
      getRowKey={(entry) => entry.id}
      onPageChange={setPage}
      pageIndex={page}
      pageSize={ledgerPageSize}
      totalCount={ledger.data.pagination.total}
    />
  );
}

export function PortfolioPage() {
  const { token } = useAuth();
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
  const riskSummary = useQuery({
    queryKey: ["risk", "summary"],
    queryFn: () => apiRequest("/api/v1/risk/summary", RiskSummarySchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 30_000
  });
  const verify = useMutation({
    mutationFn: () => apiRequest("/api/v1/portfolio/verify", PortfolioVerifyResponseSchema, token ?? undefined)
  });
  const download = useMutation({
    mutationFn: async () => {
      if (token === null) throw new Error("Sign in to download your statement.");
      const response = await fetch("/api/v1/portfolio/statement.csv", {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" }
      });
      if (!response.ok) {
        throw new Error(response.status === 401
          ? "Your session has expired. Sign in again to download the statement."
          : `Statement download failed (HTTP ${response.status}).`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "tradewise-trade-statement.csv";
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  });

  const holdings = portfolio.data?.holdings ?? [];
  const investedValue = holdings.reduce((total, holding) => total + holding.marketValuePaise, 0);
  const stockAllocation = holdings.map((holding) => ({
    name: holding.symbol,
    marketValuePaise: holding.marketValuePaise,
    concentrationPct: investedValue === 0 ? 0 : holding.marketValuePaise / investedValue * 100
  }));
  const contributions = performance.data?.holdingContributions ?? [];

  return (
    <div className="portfolio-workspace">
      <header className="portfolio-page-heading">
        <div><p className="workspace-eyebrow">Account overview</p><h2>Portfolio</h2><p>Holdings, allocation, performance, and ledger activity.</p></div>
        <div className="portfolio-actions">
          <button className="portfolio-secondary-action" disabled={download.isPending || token === null} onClick={() => download.mutate()} type="button">
            {download.isPending ? "Preparing CSV…" : "Download statement (CSV)"}
          </button>
          <button className="portfolio-primary-action" disabled={verify.isPending || token === null} onClick={() => verify.mutate()} type="button">
            {verify.isPending ? "Verifying…" : "Verify with replay"}
          </button>
        </div>
      </header>

      {download.error instanceof Error && <PortfolioMessage error>Statement download failed: {download.error.message}</PortfolioMessage>}
      {download.isSuccess && <PortfolioMessage>Statement CSV download started.</PortfolioMessage>}
      {verify.error instanceof Error && <PortfolioMessage error>Portfolio verification failed: {verify.error.message}</PortfolioMessage>}
      {verify.data !== undefined && (
        <section aria-label="Portfolio verification result" className={`portfolio-verification ${verify.data.match ? "is-match" : "has-differences"}`} role="status">
          <h3>{verify.data.match ? "✓ Portfolio matches replay" : "Portfolio differs from replay"}</h3>
          {verify.data.match ? <p>Live cash, reservations, and holdings match the ledger replay.</p> : (
            <ul>
              {verify.data.differences.map((difference) => (
                <li key={difference.field}>
                  <strong>{difference.field}</strong>
                  <span>Live: {String(difference.live)} · Replay: {String(difference.rebuilt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {portfolio.isPending ? <section aria-label="Portfolio holdings" className="workspace-panel portfolio-panel"><PortfolioMessage>Loading portfolio…</PortfolioMessage></section> :
        portfolio.error instanceof Error ? <section aria-label="Portfolio holdings" className="workspace-panel portfolio-panel"><PortfolioMessage error>Portfolio could not be loaded: {portfolio.error.message}</PortfolioMessage></section> :
          portfolio.data === undefined ? <section aria-label="Portfolio holdings" className="workspace-panel portfolio-panel"><PortfolioMessage error>Portfolio data is unavailable.</PortfolioMessage></section> : (
            <>
              <section aria-labelledby="portfolio-holdings-heading" className="workspace-panel portfolio-panel">
                <div className="portfolio-section-heading">
                  <div><p className="workspace-eyebrow">Current positions</p><h3 id="portfolio-holdings-heading">Holdings</h3></div>
                  <div className="portfolio-equity"><span>Total equity</span><strong>{formatPaise(portfolio.data.totalEquityPaise)}</strong></div>
                </div>
                {holdings.length === 0 ? <PortfolioMessage>No open holdings. New positions will appear here.</PortfolioMessage> : <HoldingTable holdings={holdings} />}
              </section>

              <section aria-labelledby="portfolio-allocation-heading" className="workspace-panel portfolio-panel">
                <div className="portfolio-section-heading">
                  <div><p className="workspace-eyebrow">Invested value</p><h3 id="portfolio-allocation-heading">Allocation</h3></div>
                  <span className="portfolio-allocation-total">{formatPaise(investedValue)} invested</span>
                </div>
                {riskSummary.isPending ? <PortfolioMessage>Loading sector allocation…</PortfolioMessage> :
                  riskSummary.error instanceof Error ? <PortfolioMessage error>Sector allocation could not be loaded: {riskSummary.error.message}</PortfolioMessage> :
                    <div className="portfolio-allocation-grid">
                      <AllocationDonut
                        description="Position weights"
                        entries={stockAllocation}
                        title="By stock"
                      />
                      <AllocationDonut
                        description="Grouped by sector"
                        entries={allocationEntries(riskSummary.data?.sectors)}
                        title="By sector"
                      />
                    </div>}
              </section>

              <section aria-labelledby="portfolio-performance-heading" className="workspace-panel portfolio-panel">
                <div className="portfolio-section-heading">
                  <div><p className="workspace-eyebrow">Returns and contribution</p><h3 id="portfolio-performance-heading">Performance</h3></div>
                </div>
                {performance.isPending ? <PortfolioMessage>Loading performance…</PortfolioMessage> :
                  performance.error instanceof Error ? <PortfolioMessage error>Performance could not be loaded: {performance.error.message}</PortfolioMessage> :
                    performance.data === undefined ? <PortfolioMessage error>Performance data is unavailable.</PortfolioMessage> : (
                      <>
                        <div className="portfolio-performance-metrics">
                          <div><span>Realized P&amp;L</span><strong className={performance.data.realizedPnlPaise >= 0 ? "is-gain" : "is-loss"}>{performance.data.realizedPnlPaise > 0 ? "+" : ""}{formatPaise(performance.data.realizedPnlPaise)}</strong></div>
                          <div><span>Unrealized P&amp;L</span><strong className={performance.data.unrealizedPnlPaise >= 0 ? "is-gain" : "is-loss"}>{performance.data.unrealizedPnlPaise > 0 ? "+" : ""}{formatPaise(performance.data.unrealizedPnlPaise)}</strong></div>
                          <div><span>Day change</span><strong className={performance.data.dayChangePaise >= 0 ? "is-gain" : "is-loss"}>{performance.data.dayChangePaise > 0 ? "+" : ""}{formatPaise(performance.data.dayChangePaise)}</strong></div>
                        </div>
                        <h4 className="portfolio-subheading">Contribution by holding</h4>
                        {contributions.length === 0 ? <PortfolioMessage>No holding contributions yet.</PortfolioMessage> : (
                          <ul className="portfolio-contribution-list">
                            {contributions.map((item) => (
                              <li key={item.symbol}>
                                <span>{item.symbol}</span>
                                <strong className={item.dayChangeContributionPaise >= 0 ? "is-gain" : "is-loss"}>
                                  {item.dayChangeContributionPaise > 0 ? "+" : ""}{formatPaise(item.dayChangeContributionPaise)}
                                </strong>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
              </section>
            </>
          )}

      <section aria-labelledby="portfolio-ledger-heading" className="workspace-panel portfolio-panel">
        <div className="portfolio-section-heading">
          <div><p className="workspace-eyebrow">Account activity</p><h3 id="portfolio-ledger-heading">Ledger</h3></div>
        </div>
        <LedgerSection />
      </section>
    </div>
  );
}

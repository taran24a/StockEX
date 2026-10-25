import { LeagueResponseSchema } from "@tradewise/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "./api";
import { useAuth } from "./auth";
import { formatPaise } from "./format";

const pageSize = 20;

export function LeaguePage() {
  const { token } = useAuth();
  const [offset, setOffset] = useState(0);
  const leaderboard = useQuery({
    queryKey: ["league", offset],
    queryFn: () => apiRequest(`/api/league?limit=${pageSize}&offset=${offset}`, LeagueResponseSchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 60_000
  });
  const data = leaderboard.data;

  return (
    <div className="workspace-league">
      <header className="workspace-page-heading">
        <p className="workspace-eyebrow">Paper trading community</p>
        <h2>League leaderboard</h2>
        <p>Rankings refresh every minute. Risk-adjusted score is return divided by the greater of maximum drawdown or 1%.</p>
      </header>
      <section aria-labelledby="league-table-heading" className="workspace-panel">
        <div className="workspace-panel-heading">
          <div><p className="workspace-eyebrow">Performance</p><h3 id="league-table-heading">Current standings</h3></div>
          {data !== undefined && <span className="workspace-subtle-link">{data.pagination.total.toLocaleString()} traders</span>}
        </div>
        {leaderboard.isPending ? <p className="workspace-panel-state" role="status">Loading leaderboard…</p> :
          leaderboard.error instanceof Error ? <p className="workspace-error" role="alert">Leaderboard could not be loaded: {leaderboard.error.message}</p> :
            data === undefined || data.entries.length === 0 ? (
              <p className="workspace-panel-state">Leaderboard standings are being calculated. Please check again shortly.</p>
            ) : (
              <div className="workspace-table-wrap">
                <table className="workspace-table">
                  <caption className="sr-only">Paginated paper-trading leaderboard ranked by risk-adjusted score</caption>
                  <thead>
                    <tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Trader</th>
                      <th scope="col">Equity</th>
                      <th scope="col">Return</th>
                      <th scope="col">Max drawdown</th>
                      <th scope="col">Risk-adjusted score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((entry) => (
                      <tr key={`${entry.rank}-${entry.displayName}`}>
                        <td>#{entry.rank}</td>
                        <th scope="row">{entry.displayName}</th>
                        <td>{formatPaise(entry.currentEquityPaise)}</td>
                        <td className={entry.returnPct >= 0 ? "is-gain" : "is-loss"}>{entry.returnPct >= 0 ? "+" : ""}{entry.returnPct.toFixed(2)}%</td>
                        <td>{entry.maxDrawdownPct.toFixed(2)}%</td>
                        <td>{entry.riskAdjustedScore.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        {leaderboard.data !== undefined && (
          <div className="workspace-pagination">
            <span>Showing {offset + 1}–{Math.min(offset + pageSize, data?.pagination.total ?? 0)} of {data?.pagination.total ?? 0}</span>
            <div>
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))} type="button">Previous</button>
              <button disabled={offset + pageSize >= leaderboard.data.pagination.total} onClick={() => setOffset(offset + pageSize)} type="button">Next</button>
            </div>
          </div>
        )}
        {data !== undefined && <p className="workspace-ai-generated">Snapshot refreshed {new Date(data.entries[0]?.updatedAt ?? Date.now()).toLocaleString()}</p>}
      </section>
    </div>
  );
}

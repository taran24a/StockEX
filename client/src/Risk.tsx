import {
  MarketInstrumentsResponseSchema,
  RiskAlertSchema,
  RiskAlertReadRequestSchema,
  RiskAlertsResponseSchema,
  RiskPreviewRequestSchema,
  RiskPreviewResponseSchema,
  RiskRulesInputSchema,
  RiskRulesSchema,
  RiskSummarySchema,
  type RiskRulesInput
} from "@tradewise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import { apiRequest } from "./api";
import { useAuth } from "./auth";
import { formatPaise } from "./format";

const alertsLimit = 50;
const ruleFormSchema = z.object({
  maxOrderNotional: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount with up to two decimal places."),
  maxSingleStockConcentration: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a percentage with up to two decimal places."),
  maxSectorConcentration: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a percentage with up to two decimal places.")
});

type RuleFormValues = z.infer<typeof ruleFormSchema>;
type RuleFormErrors = Partial<Record<keyof RuleFormValues, string>>;
type RiskTone = "safe" | "warning" | "critical";

function toneForConcentration(concentrationPct: number, limitPct: number): RiskTone {
  if (concentrationPct > limitPct) return "critical";
  if (concentrationPct >= limitPct * 0.8) return "warning";
  return "safe";
}

function RiskMessage({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`risk-message ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{children}</p>;
}

function ConcentrationGauge({
  kind,
  name,
  value,
  limit
}: {
  kind: "Stock" | "Sector";
  name: string;
  value: number;
  limit: number;
}) {
  const tone = toneForConcentration(value, limit);
  return (
    <li className={`risk-gauge is-${tone}`}>
      <div className="risk-gauge-label"><span>{kind} · {name}</span><strong>{value.toFixed(1)}%</strong></div>
      <div
        aria-label={`${kind} ${name} concentration ${value.toFixed(1)} percent, limit ${limit.toFixed(1)} percent`}
        className="risk-gauge-track"
        role="meter"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.min(value, 100)}
      >
        <span style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <small>{value > limit ? `Above ${limit.toFixed(1)}% limit` : `Limit ${limit.toFixed(1)}%`}</small>
    </li>
  );
}

function RulesForm({ token, onSaved }: { token: string; onSaved(): Promise<void> }) {
  const queryClient = useQueryClient();
  const rules = useQuery({
    queryKey: ["risk", "rules"],
    queryFn: () => apiRequest("/api/v1/risk/rules", RiskRulesSchema, token)
  });
  const [values, setValues] = useState<RuleFormValues | null>(null);
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const saveRules = useMutation({
    mutationFn: (input: RiskRulesInput) => apiRequest(
      "/api/v1/risk/rules",
      RiskRulesSchema,
      token,
      { method: "PUT", body: JSON.stringify(input) }
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["risk"] });
      await onSaved();
    }
  });
  const initialValues: RuleFormValues | null = rules.data === undefined ? null : {
    maxOrderNotional: (rules.data.maxOrderNotionalPaise / 100).toFixed(2),
    maxSingleStockConcentration: String(rules.data.maxSingleStockConcentrationPct),
    maxSectorConcentration: String(rules.data.maxSectorConcentrationPct)
  };
  const currentValues = values ?? initialValues;

  function update<K extends keyof RuleFormValues>(key: K, value: string): void {
    setValues((current) => ({ ...(current ?? initialValues ?? {
      maxOrderNotional: "",
      maxSingleStockConcentration: "",
      maxSectorConcentration: ""
    }), [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (currentValues === null) return;
    const formResult = ruleFormSchema.safeParse(currentValues);
    if (!formResult.success) {
      const nextErrors: RuleFormErrors = {};
      for (const issue of formResult.error.issues) {
        const field = issue.path[0];
        if (field === "maxOrderNotional" || field === "maxSingleStockConcentration" || field === "maxSectorConcentration") {
          nextErrors[field] = issue.message;
        }
      }
      setErrors(nextErrors);
      return;
    }

    const parsedValues = formResult.data;
    const rulesResult = RiskRulesInputSchema.safeParse({
      maxOrderNotionalPaise: Math.round(Number(parsedValues.maxOrderNotional) * 100),
      maxSingleStockConcentrationPct: Number(parsedValues.maxSingleStockConcentration),
      maxSectorConcentrationPct: Number(parsedValues.maxSectorConcentration)
    });
    if (!rulesResult.success) {
      const nextErrors: RuleFormErrors = {};
      for (const issue of rulesResult.error.issues) {
        const field = issue.path[0];
        if (field === "maxOrderNotionalPaise") nextErrors.maxOrderNotional = issue.message;
        if (field === "maxSingleStockConcentrationPct") nextErrors.maxSingleStockConcentration = issue.message;
        if (field === "maxSectorConcentrationPct") nextErrors.maxSectorConcentration = issue.message;
      }
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    saveRules.mutate(rulesResult.data);
  }

  if (rules.isPending) return <RiskMessage>Loading risk rules…</RiskMessage>;
  if (rules.error instanceof Error) return <RiskMessage error>Risk rules could not be loaded: {rules.error.message}</RiskMessage>;
  if (currentValues === null) return <RiskMessage error>Risk rules are unavailable.</RiskMessage>;

  return (
    <form className="risk-rules-form" noValidate onSubmit={submit}>
      <label>
        <span>Maximum order notional (₹)</span>
        <input
          aria-invalid={errors.maxOrderNotional !== undefined}
          aria-describedby={errors.maxOrderNotional ? "risk-max-order-error" : undefined}
          inputMode="decimal"
          onChange={(event) => update("maxOrderNotional", event.target.value)}
          value={currentValues.maxOrderNotional}
        />
        {errors.maxOrderNotional && <small id="risk-max-order-error">{errors.maxOrderNotional}</small>}
      </label>
      <label>
        <span>Maximum single-stock concentration (%)</span>
        <input
          aria-invalid={errors.maxSingleStockConcentration !== undefined}
          aria-describedby={errors.maxSingleStockConcentration ? "risk-max-stock-error" : undefined}
          inputMode="decimal"
          onChange={(event) => update("maxSingleStockConcentration", event.target.value)}
          value={currentValues.maxSingleStockConcentration}
        />
        {errors.maxSingleStockConcentration && <small id="risk-max-stock-error">{errors.maxSingleStockConcentration}</small>}
      </label>
      <label>
        <span>Maximum sector concentration (%)</span>
        <input
          aria-invalid={errors.maxSectorConcentration !== undefined}
          aria-describedby={errors.maxSectorConcentration ? "risk-max-sector-error" : undefined}
          inputMode="decimal"
          onChange={(event) => update("maxSectorConcentration", event.target.value)}
          value={currentValues.maxSectorConcentration}
        />
        {errors.maxSectorConcentration && <small id="risk-max-sector-error">{errors.maxSectorConcentration}</small>}
      </label>
      {saveRules.error instanceof Error && <RiskMessage error>Risk rules could not be saved: {saveRules.error.message}</RiskMessage>}
      {saveRules.isSuccess && <RiskMessage>Risk limits saved.</RiskMessage>}
      <button className="risk-primary-action" disabled={saveRules.isPending} type="submit">
        {saveRules.isPending ? "Saving limits…" : "Save risk limits"}
      </button>
    </form>
  );
}

function WhatIfCalculator({ token }: { token: string }) {
  const instruments = useQuery({
    queryKey: ["market", "instruments"],
    queryFn: () => apiRequest("/api/market/instruments", MarketInstrumentsResponseSchema, token)
  });
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("1");
  const preview = useMutation({
    mutationFn: () => {
      const parsed = RiskPreviewRequestSchema.safeParse({
        symbol,
        side,
        quantity: Number(quantity)
      });
      if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
      return apiRequest(
        "/api/v1/risk/preview",
        RiskPreviewResponseSchema,
        token,
        { method: "POST", body: JSON.stringify(parsed.data) }
      );
    }
  });
  const instrumentsList = instruments.data?.instruments ?? [];
  const submitPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    preview.mutate();
  };

  return (
    <div className="risk-what-if">
      {instruments.isPending ? <RiskMessage>Loading instruments…</RiskMessage> :
        instruments.error instanceof Error ? <RiskMessage error>Instruments could not be loaded: {instruments.error.message}</RiskMessage> : (
          <form className="risk-preview-form" onSubmit={submitPreview}>
            <label><span>Instrument</span>
              <select onChange={(event) => { setSymbol(event.target.value); preview.reset(); }} value={symbol}>
                <option value="">Select instrument</option>
                {instrumentsList.map(({ instrument }) => <option key={instrument.id} value={instrument.symbol}>{instrument.symbol} · {instrument.name}</option>)}
              </select>
            </label>
            <label><span>Side</span>
              <select onChange={(event) => { setSide(event.target.value as "buy" | "sell"); preview.reset(); }} value={side}>
                <option value="buy">Buy</option><option value="sell">Sell</option>
              </select>
            </label>
            <label><span>Quantity</span>
              <input min="1" onChange={(event) => { setQuantity(event.target.value); preview.reset(); }} step="1" type="number" value={quantity} />
            </label>
            <button className="risk-primary-action" disabled={preview.isPending || symbol === ""} type="submit">
              {preview.isPending ? "Calculating…" : "Preview concentration"}
            </button>
          </form>
        )}
      {preview.error instanceof Error && <RiskMessage error>Preview could not be calculated: {preview.error.message}</RiskMessage>}
      {preview.data !== undefined && (
        <section aria-label="What-if preview result" className={`risk-preview-result ${preview.data.rejection === null ? "is-allowed" : "is-rejected"}`} role="status">
          <div className="risk-preview-summary">
            <h3>{preview.data.rejection === null ? "Within configured limits" : "Would be rejected by risk limits"}</h3>
            <p>{preview.data.side.toUpperCase()} {preview.data.quantity.toLocaleString("en-IN")} {preview.data.symbol} at {formatPaise(preview.data.pricePaise)} · notional {formatPaise(preview.data.orderNotionalPaise)}</p>
            {preview.data.rejection !== null && <strong>{preview.data.rejection}</strong>}
          </div>
          <div className="risk-preview-comparison">
            <div><span>Stock · {preview.data.symbol}</span><strong>{preview.data.currentStockPct.toFixed(1)}% → {preview.data.projectedStockPct.toFixed(1)}%</strong></div>
            <div><span>Sector · {preview.data.sector}</span><strong>{preview.data.currentSectorPct.toFixed(1)}% → {preview.data.projectedSectorPct.toFixed(1)}%</strong></div>
            <p>Using the latest stored instrument price. This preview does not place an order.</p>
          </div>
        </section>
      )}
    </div>
  );
}

export function RiskPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const summary = useQuery({
    queryKey: ["risk", "summary"],
    queryFn: () => apiRequest("/api/v1/risk/summary", RiskSummarySchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 30_000
  });
  const alerts = useQuery({
    queryKey: ["risk", "alerts", alertsLimit, 0],
    queryFn: () => apiRequest(`/api/v1/risk/alerts?limit=${alertsLimit}&offset=0`, RiskAlertsResponseSchema, token ?? undefined),
    enabled: token !== null
  });
  const updateAlert = useMutation({
    mutationFn: ({ id, acknowledged }: { id: string; acknowledged: boolean }) => {
      const input = RiskAlertReadRequestSchema.parse({ acknowledged });
      return apiRequest(
        `/api/v1/risk/alerts/${encodeURIComponent(id)}`,
        RiskAlertSchema,
        token ?? undefined,
        { method: "PATCH", body: JSON.stringify(input) }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["risk", "alerts"] });
    }
  });
  const rules = useQuery({
    queryKey: ["risk", "rules"],
    queryFn: () => apiRequest("/api/v1/risk/rules", RiskRulesSchema, token ?? undefined),
    enabled: token !== null
  });
  const concentrations = useMemo(() => [
    ...(summary.data?.singleStocks ?? []).map((item) => ({ ...item, kind: "Stock" as const })),
    ...(summary.data?.sectors ?? []).map((item) => ({ ...item, kind: "Sector" as const }))
  ].sort((left, right) => right.concentrationPct - left.concentrationPct), [summary.data]);
  const alertItems = alerts.data?.alerts ?? [];

  return (
    <div className="risk-workspace">
      <header className="risk-page-heading">
        <p className="workspace-eyebrow">Guardrails &amp; exposure</p>
        <h2>Risk</h2>
        <p>Configure trading limits, monitor concentration, and preview hypothetical orders.</p>
      </header>

      <section aria-labelledby="risk-rules-heading" className="workspace-panel risk-panel">
        <div className="risk-section-heading"><div><p className="workspace-eyebrow">Account controls</p><h3 id="risk-rules-heading">Risk limits</h3></div></div>
        {token === null ? <RiskMessage error>Your session is unavailable. Sign in again to manage risk limits.</RiskMessage> : <RulesForm token={token} onSaved={() => queryClient.invalidateQueries({ queryKey: ["risk", "summary"] })} />}
      </section>

      <section aria-labelledby="risk-concentration-heading" className="workspace-panel risk-panel">
        <div className="risk-section-heading"><div><p className="workspace-eyebrow">Current exposure</p><h3 id="risk-concentration-heading">Concentration</h3></div>
          {summary.data !== undefined && <span>Total equity {formatPaise(summary.data.totalEquityPaise)}</span>}
        </div>
        {summary.isPending || rules.isPending ? <RiskMessage>Loading concentration…</RiskMessage> :
          summary.error instanceof Error ? <RiskMessage error>Concentration could not be loaded: {summary.error.message}</RiskMessage> :
            rules.error instanceof Error ? <RiskMessage error>Risk limits could not be loaded: {rules.error.message}</RiskMessage> :
              summary.data === undefined || rules.data === undefined ? <RiskMessage error>Concentration data is unavailable.</RiskMessage> :
                <>
                  {summary.data.warnings.length > 0 && <ul className="risk-warning-list">{summary.data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                  {concentrations.length === 0 ? <RiskMessage>No holdings to measure concentration.</RiskMessage> : (
                    <ul aria-label="Concentration gauges" className="risk-gauge-list">
                      {concentrations.map((item) => (
                        <ConcentrationGauge
                          key={`${item.kind}-${item.name}`}
                          kind={item.kind}
                          limit={item.kind === "Stock" ? rules.data.maxSingleStockConcentrationPct : rules.data.maxSectorConcentrationPct}
                          name={item.name}
                          value={item.concentrationPct}
                        />
                      ))}
                    </ul>
                  )}
                </>}
      </section>

      <section aria-labelledby="risk-what-if-heading" className="workspace-panel risk-panel">
        <div className="risk-section-heading"><div><p className="workspace-eyebrow">No order is placed</p><h3 id="risk-what-if-heading">What-if calculator</h3></div></div>
        {token === null ? <RiskMessage error>Your session is unavailable. Sign in to preview orders.</RiskMessage> : <WhatIfCalculator token={token} />}
      </section>

      <section aria-labelledby="risk-alerts-heading" className="workspace-panel risk-panel">
        <div className="risk-section-heading"><div><p className="workspace-eyebrow">Account notifications</p><h3 id="risk-alerts-heading">Risk alerts</h3></div>
          {alerts.data !== undefined && <span>{alerts.data.pagination.total} total</span>}
        </div>
        {alerts.isPending ? <RiskMessage>Loading risk alerts…</RiskMessage> :
          alerts.error instanceof Error ? <RiskMessage error>Risk alerts could not be loaded: {alerts.error.message}</RiskMessage> :
            alertItems.length === 0 ? <RiskMessage>No risk alerts have been recorded.</RiskMessage> : (
              <ul className="risk-alert-list">
                {alertItems.map((alert) => (
                  <li className={`risk-alert is-${alert.severity} ${alert.acknowledgedAt === null ? "is-unread" : "is-read"}`} key={alert.id}>
                    <div className="risk-alert-main">
                      <div className="risk-alert-heading"><span className={`risk-severity is-${alert.severity}`} /><strong>{alert.alertType.replaceAll("_", " ")}</strong><span className="risk-alert-state">{alert.acknowledgedAt === null ? "Unread" : "Read"}</span></div>
                      <p>{alert.message}</p>
                      <time dateTime={alert.createdAt}>{new Date(alert.createdAt).toLocaleString()}</time>
                    </div>
                    <button
                      className="risk-alert-toggle"
                      disabled={updateAlert.isPending}
                      onClick={() => updateAlert.mutate({ id: alert.id, acknowledged: alert.acknowledgedAt === null })}
                      type="button"
                    >Mark as {alert.acknowledgedAt === null ? "read" : "unread"}</button>
                  </li>
                ))}
              </ul>
            )}
        {updateAlert.error instanceof Error && <RiskMessage error>Alert status could not be updated: {updateAlert.error.message}</RiskMessage>}
      </section>
    </div>
  );
}

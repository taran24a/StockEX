import {
  OrderReplayResponseSchema,
  OrderTimelineResponseSchema,
  OrdersQuerySchema,
  PaginatedOrdersResponseSchema,
  type OrderResponse,
  type OrderStatus
} from "@tradewise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { apiRequest } from "./api";
import { useAuth } from "./auth";
import { formatPaise } from "./format";
import { Badge, DataTable, Modal, type DataTableColumn } from "./components/ui";

const pageSize = 20;
const CancelOrderResponseSchema = z.object({
  id: z.uuid(),
  status: z.literal("cancelled"),
  releasedReservationPaise: z.number().int().nonnegative().safe()
});

const orderStatuses: OrderStatus[] = [
  "pending",
  "open",
  "partially_filled",
  "filled",
  "cancelled",
  "rejected"
];

function getStatusTone(status: OrderStatus): "neutral" | "gain" | "loss" | "accent" {
  if (status === "filled") return "gain";
  if (status === "rejected" || status === "cancelled") return "loss";
  if (status === "open" || status === "partially_filled") return "accent";
  return "neutral";
}

function readPage(params: URLSearchParams): number {
  const page = Number(params.get("page") ?? 0);
  return Number.isSafeInteger(page) && page >= 0 ? page : 0;
}

function OrderTimeline({ orderId }: { orderId: string }) {
  const { token } = useAuth();
  const timeline = useQuery({
    queryKey: ["orders", orderId, "timeline"],
    queryFn: () => apiRequest(
      `/api/v1/orders/${encodeURIComponent(orderId)}/timeline`,
      OrderTimelineResponseSchema,
      token ?? undefined
    ),
    enabled: token !== null
  });

  if (timeline.isPending) return <p className="orders-panel-message" role="status">Loading order timeline…</p>;
  if (timeline.error instanceof Error) {
    return <p className="orders-panel-message is-error" role="alert">Order timeline could not be loaded: {timeline.error.message}</p>;
  }
  if (timeline.data.events.length === 0) {
    return <p className="orders-panel-message">No explainable events were recorded for this order.</p>;
  }
  return (
    <ol aria-label="Order event timeline" className="orders-timeline">
      {timeline.data.events.map((event) => (
        <li key={event.id}>
          <span aria-hidden="true" className="orders-timeline-marker" />
          <div>
            <h3>{event.eventType.replaceAll("_", " ")}</h3>
            <p>{event.message}</p>
            <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ReplayPanel({ orderId }: { orderId: string }) {
  const { token } = useAuth();
  const [frameIndex, setFrameIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const replay = useQuery({
    queryKey: ["orders", orderId, "replay"],
    queryFn: () => apiRequest(
      `/api/v1/orders/${encodeURIComponent(orderId)}/replay`,
      OrderReplayResponseSchema,
      token ?? undefined
    ),
    enabled: token !== null
  });
  const frames = replay.data?.frames ?? [];
  const currentFrame = frames[frameIndex];

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => {
        if (current + 1 >= frames.length - 1) {
          setPlaying(false);
          return Math.max(frames.length - 1, 0);
        }
        return current + 1;
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [frames.length, playing]);

  useEffect(() => {
    setFrameIndex(-1);
    setPlaying(false);
  }, [orderId]);

  if (replay.isPending) return <p className="orders-panel-message" role="status">Loading portfolio replay…</p>;
  if (replay.error instanceof Error) {
    return <p className="orders-panel-message is-error" role="alert">Portfolio replay could not be loaded: {replay.error.message}</p>;
  }

  const step = (direction: -1 | 1) => {
    setPlaying(false);
    setFrameIndex((current) => Math.min(Math.max(current + direction, -1), frames.length - 1));
  };

  return (
    <section aria-label="Portfolio replay" className="orders-replay">
      <div className="orders-replay-heading">
        <div><p className="workspace-eyebrow">Portfolio replay</p><h3>State after each event</h3></div>
        <span>{frames.length === 0 ? "No frames" : `${Math.max(frameIndex + 1, 0)} / ${frames.length}`}</span>
      </div>
      <div className="orders-replay-controls">
        <button aria-label="Previous replay step" disabled={frameIndex < 0 || playing} onClick={() => step(-1)} type="button">Previous</button>
        <button
          aria-label={playing ? "Pause replay" : "Play replay"}
          disabled={frames.length === 0}
          onClick={() => {
            if (playing) {
              setPlaying(false);
            } else {
              if (frameIndex >= frames.length - 1) setFrameIndex(-1);
              setPlaying(true);
            }
          }}
          type="button"
        >{playing ? "Pause" : "Play"}</button>
        <button aria-label="Next replay step" disabled={frameIndex >= frames.length - 1 || playing || frames.length === 0} onClick={() => step(1)} type="button">Next</button>
      </div>
      {currentFrame === undefined ? (
        <p className="orders-replay-empty">Choose Play or Next to step through the recorded account events.</p>
      ) : (
        <>
          <div aria-live="polite" className="orders-replay-state">
            <p className="workspace-eyebrow">{currentFrame.message}</p>
            <time dateTime={currentFrame.createdAt}>{new Date(currentFrame.createdAt).toLocaleString()}</time>
            <div className="orders-replay-cash"><span>Cash balance</span><strong>{formatPaise(currentFrame.cashBalancePaise)}</strong></div>
            <h4>Holdings after event</h4>
            {currentFrame.holdings.length === 0 ? <p>No holdings</p> : (
              <ul>
                {currentFrame.holdings.map((holding) => (
                  <li key={holding.symbol}><span>{holding.symbol} · {holding.quantity.toLocaleString("en-IN")} shares</span><strong>Avg {formatPaise(holding.averageCostPaise)}</strong></li>
                ))}
              </ul>
            )}
          </div>
          <input
            aria-label="Replay progress"
            className="orders-replay-progress"
            max={Math.max(frames.length - 1, 0)}
            min={-1}
            onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)); }}
            type="range"
            value={frameIndex}
          />
        </>
      )}
    </section>
  );
}

function OrderDetails({ order }: { order: OrderResponse }) {
  return (
    <div className="orders-detail-content">
      <dl className="orders-detail-summary">
        <div><dt>Symbol</dt><dd>{order.symbol}</dd></div>
        <div><dt>Side</dt><dd>{order.side.toUpperCase()}</dd></div>
        <div><dt>Type</dt><dd>{order.type.toUpperCase()}</dd></div>
        <div><dt>Status</dt><dd><Badge tone={getStatusTone(order.status)}>{order.status.replaceAll("_", " ")}</Badge></dd></div>
        <div><dt>Quantity</dt><dd>{order.quantity.toLocaleString("en-IN")}</dd></div>
        <div><dt>Filled</dt><dd>{order.filledQuantity.toLocaleString("en-IN")}</dd></div>
        {order.limitPricePaise !== null && <div><dt>Limit price</dt><dd>{formatPaise(order.limitPricePaise)}</dd></div>}
      </dl>
      <section aria-labelledby="order-timeline-heading">
        <h3 className="orders-section-title" id="order-timeline-heading">Explainable timeline</h3>
        <OrderTimeline orderId={order.id} />
      </section>
      <ReplayPanel key={order.id} orderId={order.id} />
    </div>
  );
}

export function OrdersPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusValue = searchParams.get("status") ?? "";
  const sideValue = searchParams.get("side") ?? "";
  const symbolValue = searchParams.get("symbol") ?? "";
  const dateValue = searchParams.get("date") ?? "";
  const page = readPage(searchParams);
  const [selectedOrder, setSelectedOrder] = useState<OrderResponse | null>(null);

  const filters = useMemo(() => OrdersQuerySchema.parse({
    limit: pageSize,
    offset: page * pageSize,
    ...(statusValue === "" ? {} : { status: statusValue }),
    ...(sideValue === "" ? {} : { side: sideValue }),
    ...(symbolValue.trim() === "" ? {} : { symbol: symbolValue.trim().toUpperCase() }),
    ...(dateValue === "" ? {} : { date: dateValue })
  }), [dateValue, page, sideValue, statusValue, symbolValue]);
  const ordersQuery = useQuery({
    queryKey: ["orders", "workspace", filters],
    queryFn: () => {
      const query = new URLSearchParams({
        limit: String(filters.limit),
        offset: String(filters.offset)
      });
      if (filters.status !== undefined) query.set("status", filters.status);
      if (filters.side !== undefined) query.set("side", filters.side);
      if (filters.symbol !== undefined) query.set("symbol", filters.symbol);
      if (filters.date !== undefined) query.set("date", filters.date);
      return apiRequest(`/api/v1/orders?${query}`, PaginatedOrdersResponseSchema, token ?? undefined);
    },
    enabled: token !== null,
    placeholderData: (previous) => previous
  });
  const cancelOrder = useMutation({
    mutationFn: (id: string) => apiRequest(
      `/api/v1/orders/${encodeURIComponent(id)}/cancel`,
      CancelOrderResponseSchema,
      token ?? undefined,
      { method: "POST" }
    ),
    onSuccess: async (_result, id) => {
      setSelectedOrder((current) => current?.id === id ? { ...current, status: "cancelled" } : current);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio"] })
      ]);
    }
  });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    setSearchParams(next);
  };
  const orders = ordersQuery.data?.orders ?? [];
  const pagination = ordersQuery.data?.pagination;
  const columns: DataTableColumn<OrderResponse>[] = [
    {
      key: "createdAt",
      header: "Placed",
      sortable: true,
      value: (order) => Date.parse(order.createdAt),
      render: (order) => <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString()}</time>
    },
    { key: "symbol", header: "Symbol", sortable: true, value: (order) => order.symbol, render: (order) => <strong className="orders-symbol">{order.symbol}</strong> },
    { key: "side", header: "Side", sortable: true, value: (order) => order.side, render: (order) => <span className={order.side === "buy" ? "orders-buy" : "orders-sell"}>{order.side.toUpperCase()}</span> },
    { key: "type", header: "Type", value: (order) => order.type.toUpperCase() },
    { key: "quantity", header: "Qty", sortable: true, value: (order) => order.quantity, render: (order) => order.quantity.toLocaleString("en-IN") },
    { key: "filled", header: "Filled", value: (order) => order.filledQuantity, render: (order) => order.filledQuantity.toLocaleString("en-IN") },
    { key: "price", header: "Limit", render: (order) => order.limitPricePaise === null ? "Market" : formatPaise(order.limitPricePaise) },
    { key: "status", header: "Status", value: (order) => order.status, render: (order) => <Badge tone={getStatusTone(order.status)}>{order.status.replaceAll("_", " ")}</Badge> },
    {
      key: "actions",
      header: "Actions",
      render: (order) => order.status === "open" || order.status === "partially_filled" ? (
        <button
          aria-label={`Cancel ${order.symbol} order`}
          className="orders-cancel-button"
          disabled={cancelOrder.isPending && cancelOrder.variables === order.id}
          onClick={(event) => { event.stopPropagation(); cancelOrder.mutate(order.id); }}
          type="button"
        >{cancelOrder.isPending && cancelOrder.variables === order.id ? "Cancelling…" : "Cancel"}</button>
      ) : "—"
    }
  ];

  return (
    <div className="orders-workspace">
      <header className="orders-page-heading">
        <div><p className="workspace-eyebrow">Your trading activity</p><h2>Orders</h2><p>Filter orders, inspect the decision trail, and replay portfolio changes.</p></div>
      </header>
      <section aria-label="Filter orders" className="workspace-panel orders-filter-panel">
        <label><span>Status</span>
          <select aria-label="Filter by status" onChange={(event) => setFilter("status", event.target.value)} value={statusValue}>
            <option value="">All statuses</option>
            {orderStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <label><span>Side</span>
          <select aria-label="Filter by side" onChange={(event) => setFilter("side", event.target.value)} value={sideValue}>
            <option value="">Buy and sell</option><option value="buy">Buy</option><option value="sell">Sell</option>
          </select>
        </label>
        <label><span>Symbol</span>
          <input aria-label="Filter by symbol" onChange={(event) => setFilter("symbol", event.target.value)} placeholder="e.g. ALFA" type="search" value={symbolValue} />
        </label>
        <label><span>Date</span>
          <input aria-label="Filter by date" onChange={(event) => setFilter("date", event.target.value)} type="date" value={dateValue} />
        </label>
        <button className="orders-reset-button" disabled={searchParams.size === 0} onClick={() => setSearchParams(new URLSearchParams())} type="button">Clear filters</button>
      </section>

      {ordersQuery.isPending ? <p className="orders-panel-message" role="status">Loading orders…</p> :
        ordersQuery.error instanceof Error ? <p className="orders-panel-message is-error" role="alert">Orders could not be loaded: {ordersQuery.error.message}</p> : null}
      {cancelOrder.error instanceof Error && <p className="orders-panel-message is-error" role="alert">Order could not be cancelled: {cancelOrder.error.message}</p>}
      {ordersQuery.data !== undefined && pagination !== undefined && (
        <section aria-label="Order history" className="workspace-panel orders-table-panel">
          {orders.length === 0 ? (
            <p className="orders-panel-message">No orders match these filters.</p>
          ) : (
            <DataTable
              columns={columns}
              data={orders}
              emptyDescription="Try changing the order filters."
              emptyTitle="No matching orders"
              getRowKey={(order) => order.id}
              onPageChange={(nextPage) => {
                const next = new URLSearchParams(searchParams);
                if (nextPage === 0) next.delete("page");
                else next.set("page", String(nextPage));
                setSearchParams(next);
              }}
              onRowClick={setSelectedOrder}
              pageIndex={page}
              pageSize={pageSize}
              totalCount={pagination.total}
            />
          )}
          <p className="orders-table-hint">Select an order row to open its event timeline and replay.</p>
        </section>
      )}

      <Modal open={selectedOrder !== null} onClose={() => setSelectedOrder(null)} title={selectedOrder === null ? "Order details" : `${selectedOrder.symbol} order`}>
        {selectedOrder !== null && <OrderDetails order={selectedOrder} />}
      </Modal>
    </div>
  );
}

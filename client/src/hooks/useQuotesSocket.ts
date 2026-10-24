import {
  WebSocketClientMessageSchema,
  WebSocketServerMessageSchema,
  type Quote,
  type WebSocketServerMessage
} from "@tradewise/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "../auth";

export type QuotesSocketStatus = "connecting" | "connected" | "disconnected";
type OrderUpdate = Extract<WebSocketServerMessage, { type: "order.update" }>;

const reconnectDelay = (attempt: number) => Math.min(1_000 * 2 ** Math.min(attempt, 5), 30_000);

function updateQuoteCache(
  current: { quotes: Quote[] } | undefined,
  quote: Quote
) {
  const quotes = current?.quotes ?? [];
  const index = quotes.findIndex((item) => item.symbol === quote.symbol);
  if (index === -1) {
    return { quotes: [...quotes, quote] };
  }
  return { quotes: quotes.map((item, itemIndex) => itemIndex === index ? quote : item) };
}

export function useQuotesSocket() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<QuotesSocketStatus>("disconnected");
  const [recentOrderEvents, setRecentOrderEvents] = useState<OrderUpdate[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === null) {
      setStatus("disconnected");
      setRecentOrderEvents([]);
      setError(null);
      return;
    }

    let active = true;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    let retry = 0;

    const reconnect = () => {
      if (!active) {
        return;
      }
      setStatus("connecting");
      try {
        const url = new URL("/ws", window.location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("token", token);
        socket = new WebSocket(url);
      } catch {
        setError("The authenticated live connection could not be started.");
        setStatus("disconnected");
        timer = window.setTimeout(reconnect, reconnectDelay(retry++));
        return;
      }

      const currentSocket = socket;
      currentSocket.addEventListener("open", () => {
        if (!active) {
          return;
        }
        retry = 0;
        setStatus("connected");
        setError(null);
        const message = WebSocketClientMessageSchema.parse({
          type: "subscribe",
          channels: ["quotes", "orders", "portfolio"]
        });
        currentSocket.send(JSON.stringify(message));
      });
      currentSocket.addEventListener("message", (event) => {
        if (!active) {
          return;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(String(event.data));
        } catch {
          setError("A live update could not be read. The connection remains active.");
          return;
        }
        const parsed = WebSocketServerMessageSchema.safeParse(raw);
        if (!parsed.success) {
          setError("A live update did not match the expected data format.");
          return;
        }
        handleMessage(parsed.data);
      });
      currentSocket.addEventListener("error", () => {
        if (active) {
          setError("The authenticated live connection is unavailable. Reconnecting…");
        }
      });
      currentSocket.addEventListener("close", () => {
        if (!active) {
          return;
        }
        setStatus("disconnected");
        timer = window.setTimeout(reconnect, reconnectDelay(retry++));
      });
    };

    const handleMessage = (message: WebSocketServerMessage) => {
      if (message.type === "quote") {
        queryClient.setQueryData(["quotes"], (current: { quotes: Quote[] } | undefined) =>
          updateQuoteCache(current, message.data)
        );
        queryClient.setQueryData(["landing", "quotes"], (current: { quotes: Quote[] } | undefined) =>
          updateQuoteCache(current, message.data)
        );
      } else if (message.type === "order.update") {
        setRecentOrderEvents((current) => [message, ...current.filter((item) => item.data.id !== message.data.id)].slice(0, 5));
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["orders"] }),
          queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
          queryClient.invalidateQueries({ queryKey: ["portfolio", "performance"] }),
          queryClient.invalidateQueries({ queryKey: ["risk"] }),
          queryClient.invalidateQueries({ queryKey: ["risk", "alerts"] })
        ]);
      } else if (message.type === "portfolio.update") {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
          queryClient.invalidateQueries({ queryKey: ["portfolio", "performance"] }),
          queryClient.invalidateQueries({ queryKey: ["orders"] }),
          queryClient.invalidateQueries({ queryKey: ["risk"] }),
          queryClient.invalidateQueries({ queryKey: ["risk", "alerts"] })
        ]);
      } else if (message.type === "error") {
        setError(message.message);
      }
    };

    reconnect();
    return () => {
      active = false;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      socket?.close();
    };
  }, [queryClient, token]);

  return { status, recentOrderEvents, error };
}

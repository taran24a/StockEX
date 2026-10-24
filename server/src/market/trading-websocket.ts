import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  WebSocketClientMessageSchema,
  WebSocketServerMessageSchema
} from "@tradewise/shared";
import type {
  WebSocketChannel,
  WebSocketServerMessage
} from "@tradewise/shared";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import { z } from "zod";
import { eventBus } from "../events/bus.js";
import { logger } from "../logger.js";
import { WebSocket, WebSocketServer } from "ws";

const ClaimsSchema = z.object({
  sub: z.uuid(),
  role: z.enum(["user", "admin"])
});

const HEARTBEAT_INTERVAL_MS = 30_000;

interface ConnectedClient {
  userId: string;
  socket: WebSocket;
  channels: Set<WebSocketChannel>;
  alive: boolean;
}

interface OrderOwnerRow {
  user_id: string;
}

interface FillOwnerRow {
  id: string;
  account_id: string;
  user_id: string;
  side: "buy" | "sell";
}

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function send(client: ConnectedClient, message: WebSocketServerMessage): void {
  if (client.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  const parsed = WebSocketServerMessageSchema.parse(message);
  client.socket.send(JSON.stringify(parsed));
}

export function attachTradingWebSocket(
  server: Server,
  pool: Pool,
  secret: string,
  heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS
): () => void {
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const clients = new Set<ConnectedClient>();

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      return;
    }
    if (url.pathname !== "/ws") {
      return;
    }
    const tokens = url.searchParams.getAll("token");
    if (tokens.length !== 1 || tokens[0] === undefined) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    try {
      const payload = jwt.verify(tokens[0], secret);
      if (typeof payload === "string") {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      const claims = ClaimsSchema.safeParse(payload);
      if (!claims.success) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      const userId = claims.data.sub;
      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketServer.emit("connection", websocket, request, userId);
      });
    } catch {
      rejectUpgrade(socket, 401, "Unauthorized");
    }
  };

  websocketServer.on("connection", (socket: WebSocket, _request: IncomingMessage, userId: string) => {
    const client: ConnectedClient = {
      userId,
      socket,
      channels: new Set(),
      alive: true
    };
    clients.add(client);
    send(client, { type: "ready", userId });

    socket.on("pong", () => {
      client.alive = true;
    });
    socket.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        send(client, {
          type: "error",
          code: "INVALID_MESSAGE",
          message: "WebSocket messages must contain valid JSON"
        });
        return;
      }
      const parsed = WebSocketClientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        send(client, {
          type: "error",
          code: "INVALID_MESSAGE",
          message: "WebSocket message does not match the shared protocol"
        });
        return;
      }
      for (const channel of parsed.data.channels) {
        client.channels.add(channel);
      }
      send(client, { type: "subscribed", channels: parsed.data.channels });
    });
    socket.on("close", () => {
      clients.delete(client);
    });
    socket.on("error", (error) => {
      logger.warn({ err: error, userId }, "Trading WebSocket connection error");
    });
  });

  const onQuote = (quote: Parameters<typeof eventBus.emit<"quote">>[1]): void => {
    for (const client of clients) {
      if (client.channels.has("quotes")) {
        send(client, { type: "quote", data: quote });
      }
    }
  };

  const onOrder = (event: Parameters<typeof eventBus.emit<"order">>[1]): void => {
    void pool.query<OrderOwnerRow>(
      `SELECT account.user_id
       FROM orders AS order_row
       JOIN accounts AS account ON account.id = order_row.account_id
       WHERE order_row.id = $1`,
      [event.aggregateId]
    ).then((result) => {
      const userId = result.rows[0]?.user_id;
      if (userId === undefined) {
        return;
      }
      const message: WebSocketServerMessage = {
        type: "order.update",
        data: {
          id: event.id,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
          payload: event.payload
        }
      };
      for (const client of clients) {
        if (client.userId === userId && client.channels.has("orders")) {
          send(client, message);
        }
      }
    }).catch((error: unknown) => {
      logger.error({ err: error, orderId: event.aggregateId }, "Could not resolve private order event owner");
    });
  };

  const onFill = (event: Parameters<typeof eventBus.emit<"fill">>[1]): void => {
    void pool.query<FillOwnerRow>(
      `SELECT order_row.id, account.id AS account_id, account.user_id, order_row.side
       FROM orders AS order_row
       JOIN accounts AS account ON account.id = order_row.account_id
       WHERE order_row.id = ANY($1::uuid[])`,
      [[event.fill.makerOrderId, event.fill.takerOrderId]]
    ).then((result) => {
      for (const owner of result.rows) {
        const feePaise = owner.id === event.fill.makerOrderId
          ? event.makerFeePaise
          : event.takerFeePaise;
        for (const client of clients) {
          if (client.userId === owner.user_id && client.channels.has("portfolio")) {
            send(client, {
              type: "portfolio.update",
              data: {
                accountId: owner.account_id,
                fillId: event.fillId,
                symbol: event.fill.symbol,
                side: owner.side,
                quantity: event.fill.quantity,
                pricePaise: event.fill.pricePaise,
                feePaise
              }
            });
          }
        }
      }
    }).catch((error: unknown) => {
      logger.error({ err: error, fillId: event.fillId }, "Could not resolve private portfolio event owners");
    });
  };

  eventBus.on("quote", onQuote);
  eventBus.on("order", onOrder);
  eventBus.on("fill", onFill);
  server.on("upgrade", handleUpgrade);

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();

  return () => {
    clearInterval(heartbeat);
    server.off("upgrade", handleUpgrade);
    eventBus.off("quote", onQuote);
    eventBus.off("order", onOrder);
    eventBus.off("fill", onFill);
    for (const client of clients) {
      client.socket.close(1001, "Server shutting down");
    }
    clients.clear();
    websocketServer.close();
  };
}

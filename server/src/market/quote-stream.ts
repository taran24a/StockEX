import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { QuotesResponseSchema } from "@tradewise/shared";
import { logger } from "../logger.js";

export function attachQuoteStream(server: Server, feedUrl: string): () => void {
  const apiSockets = new WebSocketServer({ noServer: true });

  const handleUpgrade = (request: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/api/quotes/ws") {
      return;
    }
    apiSockets.handleUpgrade(request, socket, head, (client) => {
      apiSockets.emit("connection", client, request);
    });
  };
  server.on("upgrade", handleUpgrade);

  // SYLLABUS: EventEmitter
  apiSockets.on("connection", (client) => {
    const feedSocketUrl = new URL("/ws", feedUrl);
    feedSocketUrl.protocol = feedSocketUrl.protocol === "https:" ? "wss:" : "ws:";
    const feedSocket = new WebSocket(feedSocketUrl);

    feedSocket.on("message", (data) => {
      let payload: unknown;
      try {
        payload = JSON.parse(data.toString());
      } catch (error) {
        logger.warn({ err: error }, "Market feed sent malformed WebSocket data");
        client.close(1011, "Invalid market feed data");
        feedSocket.close();
        return;
      }

      const parsed = QuotesResponseSchema.safeParse(payload);
      if (!parsed.success) {
        logger.warn({ issues: parsed.error.issues }, "Market feed WebSocket payload failed validation");
        client.close(1011, "Invalid market feed data");
        feedSocket.close();
        return;
      }
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(parsed.data));
      }
    });

    feedSocket.on("error", (error) => {
      logger.error({ err: error }, "Market feed WebSocket connection failed");
      if (client.readyState === WebSocket.OPEN) {
        client.close(1011, "Market feed unavailable");
      }
    });
    client.on("close", () => feedSocket.close());
  });

  return () => {
    server.off("upgrade", handleUpgrade);
    for (const client of apiSockets.clients) {
      client.close(1001, "Server shutting down");
    }
    apiSockets.close();
  };
}

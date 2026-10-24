import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { HealthResponseSchema, QuotesResponseSchema } from "@tradewise/shared";
import { advanceQuotes, initialQuotes } from "./market.js";

let quotes = initialQuotes();
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(HealthResponseSchema.parse({ status: "ok" })));
    return;
  }
  if (request.method === "GET" && (pathname === "/prices" || pathname === "/quotes")) {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(QuotesResponseSchema.parse({ quotes })));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Feed route not found" } }));
});

// SYLLABUS: raw http
const websocketServer = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (client) => {
    websocketServer.emit("connection", client, request);
  });
});

// SYLLABUS: EventEmitter
websocketServer.on("connection", (socket) => {
  socket.send(JSON.stringify(QuotesResponseSchema.parse({ quotes })));
});

const timer = setInterval(() => {
  // SYLLABUS: event loop
  quotes = advanceQuotes(quotes);
  const update = JSON.stringify(QuotesResponseSchema.parse({ quotes }));
  for (const socket of websocketServer.clients) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(update);
    }
  }
}, 1_000);

const port = Number(process.env.FEED_PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("FEED_PORT must be an integer between 1 and 65535");
}

server.listen(port, () => {
  console.info(`TradeWise synthetic quote feed listening on ${port}`);
});

function shutdown(): void {
  clearInterval(timer);
  for (const socket of websocketServer.clients) {
    socket.close(1001, "Feed shutting down");
  }
  websocketServer.close();
  server.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

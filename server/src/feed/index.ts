import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { HealthResponseSchema, QuotesResponseSchema } from "@tradewise/shared";
import { advanceQuotes, initialQuotes } from "./market.js";

const app = express();
app.disable("x-powered-by");
let quotes = initialQuotes();

app.get("/health", (_request, response) => {
  response.json(HealthResponseSchema.parse({ status: "ok" }));
});

app.get("/quotes", (_request, response) => {
  response.json(QuotesResponseSchema.parse({ quotes }));
});

// SYLLABUS: raw http
const server = createServer(app);
const websocketServer = new WebSocketServer({ server, path: "/ws" });

// SYLLABUS: EventEmitter
websocketServer.on("connection", (socket) => {
  socket.send(JSON.stringify(QuotesResponseSchema.parse({ quotes })));
});

const timer = setInterval(() => {
  // SYLLABUS: event loop
  quotes = advanceQuotes(quotes);
  const update = JSON.stringify(QuotesResponseSchema.parse({ quotes }));
  for (const socket of websocketServer.clients) {
    if (socket.readyState === socket.OPEN) {
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
  websocketServer.close();
  server.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

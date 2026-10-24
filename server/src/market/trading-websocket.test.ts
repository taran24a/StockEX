import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { eventBus } from "../events/bus.js";
import { attachTradingWebSocket } from "./trading-websocket.js";

const secret = "test-secret-long-enough-for-the-websocket-suite";
const userA = "4b8fbe96-52f4-45b9-a373-195af22bcf22";
const userB = "ac8fbe96-52f4-45b9-a373-195af22bcf22";
const accountA = "bc8fbe96-52f4-45b9-a373-195af22bcf22";
const accountB = "dc8fbe96-52f4-45b9-a373-195af22bcf22";
const orderA = "ec8fbe96-52f4-45b9-a373-195af22bcf22";
const orderB = "fc8fbe96-52f4-45b9-a373-195af22bcf22";
const orderEventId = "1c8fbe96-52f4-45b9-a373-195af22bcf22";
const fillId = "0c8fbe96-52f4-45b9-a373-195af22bcf22";

const servers: Array<{ close: () => Promise<void>; stop: () => void }> = [];

function token(userId: string): string {
  return jwt.sign({ role: "user" }, secret, { subject: userId, expiresIn: "1h" });
}

async function createTestServer(pool: Pool) {
  const server = createServer();
  const stop = attachTradingWebSocket(server, pool, secret, 60_000);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test HTTP server did not bind to a TCP port");
  }
  const close = async (): Promise<void> => {
    stop();
    for (const socket of websocketClients) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
        socket.terminate();
      }
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  };
  const resource = { close, stop };
  servers.push(resource);
  return { url: `ws://127.0.0.1:${address.port}/ws`, close };
}

const websocketClients: WebSocket[] = [];

function connect(url: string, userId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${url}?token=${encodeURIComponent(token(userId))}`);
    websocketClients.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 2_000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", handleMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);
    const handleMessage = (data: Buffer): void => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (predicate(message)) {
        clearTimeout(timeout);
        socket.off("message", handleMessage);
        resolve(message);
      }
    };
    socket.on("message", handleMessage);
  });
}

async function subscribe(socket: WebSocket): Promise<void> {
  const subscribed = waitForMessage(
    socket,
    (message) => message.type === "subscribed" &&
      Array.isArray(message.channels) &&
      message.channels.length === 3
  );
  socket.send(JSON.stringify({
    type: "subscribe",
    channels: ["quotes", "orders", "portfolio"]
  }));
  await subscribed;
}

afterEach(async () => {
  const current = servers.splice(0);
  await Promise.all(current.map((server) => server.close()));
  websocketClients.length = 0;
});

describe("trading WebSocket", () => {
  it("broadcasts quotes and fans out order and portfolio updates only to the owners", async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes("FROM orders AS order_row") && sql.includes("WHERE order_row.id = $1")) {
        return Promise.resolve({ rows: [{ user_id: userA }] });
      }
      if (sql.includes("FROM orders AS order_row") && sql.includes("ANY($1::uuid[])")) {
        return Promise.resolve({
          rows: [
            { id: orderA, account_id: accountA, user_id: userA, side: "buy" },
            { id: orderB, account_id: accountB, user_id: userB, side: "sell" }
          ]
        });
      }
      throw new Error(`Unexpected database query: ${sql}`);
    });
    const { url } = await createTestServer({ query } as unknown as Pool);
    const [socketA, socketB] = await Promise.all([connect(url, userA), connect(url, userB)]);
    await Promise.all([subscribe(socketA), subscribe(socketB)]);

    const quoteA = waitForMessage(socketA, (message) => message.type === "quote");
    const quoteB = waitForMessage(socketB, (message) => message.type === "quote");
    eventBus.emit("quote", {
      symbol: "ALFA",
      name: "Alfa Industries",
      pricePaise: 12_500,
      changePaise: 125,
      updatedAt: new Date().toISOString()
    });
    expect((await quoteA).type).toBe("quote");
    expect((await quoteB).type).toBe("quote");

    const orderUpdateA = waitForMessage(socketA, (message) => message.type === "order.update");
    eventBus.emit("order", {
      id: orderEventId,
      aggregateId: orderA,
      eventType: "ORDER_FILLED",
      payload: { symbol: "ALFA" }
    });
    await orderUpdateA;
    await expect(waitForMessage(
      socketB,
      (message) => message.type === "order.update",
      100
    )).rejects.toThrow("Timed out waiting for WebSocket message");

    const portfolioUpdateA = waitForMessage(socketA, (message) => message.type === "portfolio.update");
    const portfolioUpdateB = waitForMessage(socketB, (message) => message.type === "portfolio.update");
    eventBus.emit("fill", {
      fill: {
        symbol: "ALFA",
        makerOrderId: orderA,
        takerOrderId: orderB,
        pricePaise: 12_500,
        quantity: 2
      },
      fillId,
      makerAccountId: accountA,
      takerAccountId: accountB,
      makerFeePaise: 1,
      takerFeePaise: 1
    });
    const [updateA, updateB] = await Promise.all([portfolioUpdateA, portfolioUpdateB]);
    expect(updateA.data).toMatchObject({ accountId: accountA, side: "buy", feePaise: 1 });
    expect(updateB.data).toMatchObject({ accountId: accountB, side: "sell", feePaise: 1 });
  });

  it("rejects connections without a valid JWT token", async () => {
    const query = vi.fn();
    const { url } = await createTestServer({ query } as unknown as Pool);
    const socket = new WebSocket(url);
    websocketClients.push(socket);
    const closeCode = await new Promise<number>((resolve) => {
      socket.once("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
      });
      socket.once("close", (code) => resolve(code));
    });
    expect(closeCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});

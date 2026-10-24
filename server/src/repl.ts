import { start } from "node:repl";
import { loadEnvironment } from "./config/index.js";
import { createDatabasePool } from "./db/pool.js";
import { eventBus } from "./events/bus.js";
import { OrderBook } from "./engine/order-book.js";

const environment = loadEnvironment();
const pool = createDatabasePool(environment);
const engine = new OrderBook("DEMO");

// SYLLABUS: REPL
const repl = start({
  prompt: "tradewise> ",
  useGlobal: false,
  ignoreUndefined: true
});
Object.assign(repl.context, {
  engine,
  bus: eventBus,
  pool
});
repl.on("exit", () => {
  void pool.end().catch((error: unknown) => {
    console.error("Could not close the REPL database pool", error);
    process.exitCode = 1;
  });
});

console.info("TradeWise REPL: engine (DEMO order book), bus, and pool are available.");

import express from "express";
import type { Pool } from "pg";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { createWatchlistsRouter } from "./watchlists.js";

const secret = "unit-test-secret-with-at-least-32-characters";
const userId = "bbdf32c0-1138-4eba-bad1-95f8d1c29a13";
const otherUsersListId = "6c69d530-ce18-4543-a41a-ef904c81db66";

function watchlistsApp(pool: Pool) {
  const app = express();
  app.use("/watchlists", createWatchlistsRouter(pool, secret));
  app.use(errorHandler);
  return app;
}

describe("watchlist ownership", () => {
  it("does not expose another account's watchlist", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const token = jwt.sign({ sub: userId, role: "user" }, secret);

    const response = await request(watchlistsApp({ query } as unknown as Pool))
      .get(`/watchlists/${otherUsersListId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([otherUsersListId, userId]);
  });
});

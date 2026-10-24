import { Router } from "express";
import { QuotesResponseSchema } from "@tradewise/shared";
import { fetchQuotes } from "../market/feed-client.js";

export function createQuotesRouter(feedUrl: string): Router {
  const router = Router();

  router.get("/", async (_request, response) => {
    const quotes = await fetchQuotes(feedUrl);
    response.json(QuotesResponseSchema.parse({ quotes }));
  });

  return router;
}

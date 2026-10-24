import { QuotesResponseSchema } from "@tradewise/shared";
import { logger } from "../logger.js";
import { ApiError } from "../errors.js";

export async function fetchQuotes(feedUrl: string) {
  let response: Response;
  try {
    // SYLLABUS: fetch/async-await
    response = await fetch(new URL("/quotes", feedUrl), {
      signal: AbortSignal.timeout(3_000)
    });
  } catch (error) {
    logger.error({ err: error }, "Market feed request failed");
    throw new ApiError(503, "MARKET_FEED_UNAVAILABLE", "Market quotes are temporarily unavailable");
  }

  if (!response.ok) {
    throw new ApiError(502, "MARKET_FEED_ERROR", "Market feed returned an unsuccessful response");
  }
  const parsed = QuotesResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues }, "Market feed returned an invalid quote payload");
    throw new ApiError(502, "INVALID_MARKET_FEED_RESPONSE", "Market feed returned invalid quote data");
  }
  return parsed.data.quotes;
}

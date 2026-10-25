import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  AiExplainResponseSchema
} from "@tradewise/shared";
import type { Environment } from "../config/index.js";
import type { Pool } from "pg";
import { authenticate } from "../middleware/authenticate.js";
import { ApiError } from "../services/errors.js";
import {
  calculatePortfolioInsight,
  deterministicPortfolioExplanation,
  numericOnlyInsightInput
} from "../services/portfolio-insight.js";
import { logger } from "../logger.js";
import { z } from "zod";

const GeneratedExplanationSchema = z.object({
  summary: z.string().trim().min(1).max(700),
  observations: z.array(z.string().trim().min(1).max(220)).max(4)
}).strict();
const OllamaResponseSchema = z.object({ response: z.string() });

const ollamaFormat = {
  type: "object",
  properties: {
    summary: { type: "string" },
    observations: { type: "array", items: { type: "string" } }
  },
  required: ["summary", "observations"],
  additionalProperties: false
};

async function explainWithOllama(
  environment: Environment,
  numericInput: Record<string, unknown>
): Promise<{ explanation: string; highlights: string[] } | null> {
  let response: Response;
  try {
    response = await fetch(`${environment.OLLAMA_BASE_URL.replace(/\/+$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        model: environment.OLLAMA_MODEL,
        stream: false,
        format: ollamaFormat,
        system: "You explain simulated investment portfolio metrics for education. Treat the supplied numeric JSON as the complete and exclusive source of facts. Do not infer symbols, identities, causes, future outcomes, or missing values. Do not recommend trades or provide financial advice. Return only the requested JSON object with one concise factual summary and at most four concise observations.",
        prompt: `Explain these portfolio figures without making recommendations. Values are integer paise unless they are percentages. Data: ${JSON.stringify(numericInput)}`
      })
    });
  } catch (error) {
    logger.warn({ err: error, model: environment.OLLAMA_MODEL }, "Local portfolio explanation model is unavailable");
    return null;
  }

  if (!response.ok) {
    logger.warn({ statusCode: response.status, model: environment.OLLAMA_MODEL }, "Local portfolio explanation model rejected the request");
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(502, "INVALID_AI_RESPONSE", "The local explanation model returned invalid JSON");
  }
  const ollamaResult = OllamaResponseSchema.safeParse(payload);
  if (!ollamaResult.success) {
    throw new ApiError(502, "INVALID_AI_RESPONSE", "The local explanation model returned an invalid response");
  }
  let generated: unknown;
  try {
    generated = JSON.parse(ollamaResult.data.response) as unknown;
  } catch {
    throw new ApiError(502, "INVALID_AI_RESPONSE", "The local explanation model did not return valid explanation JSON");
  }
  const parsed = GeneratedExplanationSchema.safeParse(generated);
  if (!parsed.success) {
    throw new ApiError(502, "INVALID_AI_RESPONSE", "The local explanation model output did not match the required schema");
  }
  return {
    explanation: parsed.data.summary,
    highlights: parsed.data.observations
  };
}

export function createAiRouter(pool: Pool, environment: Environment): Router {
  const router = Router();
  router.use(authenticate(environment.JWT_SECRET));
  const readLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (request) => request.auth!.id
  });
  const generateLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (request) => request.auth!.id
  });

  router.get("/explain", readLimiter, async (request, response) => {
    const metrics = await calculatePortfolioInsight(pool, request.auth!.id);
    response.json(AiExplainResponseSchema.parse({
      source: "template",
      ...deterministicPortfolioExplanation(metrics),
      metrics,
      generatedAt: new Date().toISOString()
    }));
  });

  router.post("/explain", generateLimiter, async (request, response) => {
    const metrics = await calculatePortfolioInsight(pool, request.auth!.id);
    const generated = await explainWithOllama(environment, numericOnlyInsightInput(metrics));
    response.json(AiExplainResponseSchema.parse({
      source: generated === null ? "template" : "ollama",
      ...(generated ?? deterministicPortfolioExplanation(metrics)),
      metrics,
      generatedAt: new Date().toISOString()
    }));
  });

  return router;
}

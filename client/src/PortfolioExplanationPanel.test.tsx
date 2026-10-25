import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortfolioExplanationPanel } from "./DashboardOverview";

const { apiRequestMock, useAuthMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  useAuthMock: vi.fn()
}));

vi.mock("./api", () => ({ apiRequest: apiRequestMock }));
vi.mock("./auth", () => ({ useAuth: useAuthMock }));
vi.mock("./hooks/useQuotesSocket", () => ({
  useQuotesSocket: () => ({ status: "disconnected", recentOrderEvents: [], error: null })
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("portfolio explanation card", () => {
  it("requests a portfolio explanation and identifies deterministic fallback output", async () => {
    useAuthMock.mockReturnValue({ token: "user-token" });
    apiRequestMock.mockResolvedValue({
      source: "template",
      explanation: "Portfolio return is 2.00%.",
      highlights: ["1 holding; equity 102 paise."],
      metrics: {
        totalEquityPaise: 102,
        cashBalancePaise: 2,
        contributedCapitalPaise: 100,
        returnPct: 2,
        realizedPnlPaise: 0,
        unrealizedPnlPaise: 1,
        dayChangePaise: 1,
        holdings: []
      },
      generatedAt: "2026-10-25T00:00:00.000Z"
    });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <PortfolioExplanationPanel />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Explain my portfolio" }));

    expect(await screen.findByText("Portfolio return is 2.00%.")).toBeTruthy();
    expect(screen.getByText("Data summary")).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/ai/explain",
      expect.anything(),
      "user-token",
      { method: "POST" }
    );
  });
});

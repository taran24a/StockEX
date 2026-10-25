import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeaguePage } from "./League";

const { apiRequestMock, useAuthMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  useAuthMock: vi.fn()
}));

vi.mock("./api", () => ({ apiRequest: apiRequestMock }));
vi.mock("./auth", () => ({ useAuth: useAuthMock }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("league workspace", () => {
  it("shows paginated standings and requests the next page", async () => {
    useAuthMock.mockReturnValue({ token: "user-token" });
    apiRequestMock.mockImplementation((path: string) => Promise.resolve({
      entries: [{
        rank: path.includes("offset=20") ? 21 : 1,
        displayName: "Trader",
        currentEquityPaise: 110_000_000,
        returnPct: 10,
        maxDrawdownPct: 2,
        riskAdjustedScore: 5,
        updatedAt: "2026-10-25T05:00:00.000Z"
      }],
      pagination: {
        limit: 20,
        offset: path.includes("offset=20") ? 20 : 0,
        total: 25
      }
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <LeaguePage />
      </QueryClientProvider>
    );
    expect(await screen.findByRole("rowheader", { name: "Trader" })).toBeTruthy();
    expect(screen.getByText("+10.00%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/league?limit=20&offset=20",
      expect.anything(),
      "user-token"
    ));
    expect(await screen.findByText("#21")).toBeTruthy();
  });
});

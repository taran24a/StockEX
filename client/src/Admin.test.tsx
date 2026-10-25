import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AdminPage } from "./Admin";

const { apiRequestMock, useAuthMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  useAuthMock: vi.fn()
}));

vi.mock("./api", () => ({ apiRequest: apiRequestMock }));
vi.mock("./auth", () => ({ useAuth: useAuthMock }));

const currentUser = {
  id: "8af8401d-00c7-49f0-aeae-914c82dbdd72",
  email: "admin@example.com",
  displayName: "Administrator",
  role: "admin"
};
const listedUser = {
  id: "b6f2a204-bdc9-466d-aeba-709090840c7a",
  email: "trader@example.com",
  displayName: "Trader",
  role: "user",
  createdAt: "2026-10-01T10:00:00.000Z"
};
const simulationState = {
  marketMaker: { available: true, running: true },
  ticker: { available: true, running: true }
};

function renderAdmin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><AdminPage /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  useAuthMock.mockReturnValue({ token: "admin-token", user: currentUser });
  apiRequestMock.mockImplementation((path: string, _schema: unknown, _token: string | undefined, init?: RequestInit) => {
    if (path === "/api/admin/stats") return Promise.resolve({ users: 6, orders: 120, volumePaise: 245_500, rejectedOrderPct: 2.5 });
    if (path.startsWith("/api/admin/users?")) return Promise.resolve({
      users: [listedUser],
      pagination: { limit: 20, offset: 0, total: 1 }
    });
    if (path === `/api/admin/users/${listedUser.id}/role`) return Promise.resolve({ ...listedUser, role: JSON.parse(String(init?.body)).role });
    if (path.startsWith("/api/admin/audit?")) return Promise.resolve({
      events: [{
        id: "6005ca90-68da-4610-9fd7-347a7127e344",
        aggregateType: "order",
        aggregateId: "b6f2a204-bdc9-466d-aeba-709090840c7a",
        eventType: "ORDER_ACCEPTED",
        sequenceNumber: 1,
        payload: { symbol: "NOVA" },
        requestId: null,
        createdAt: "2026-10-25T10:00:00.000Z"
      }],
      pagination: { limit: 20, offset: 0, total: 1 }
    });
    if (path === "/api/admin/simulation-controls" && init?.method === "PATCH") {
      const input = JSON.parse(String(init.body)) as { name: "marketMaker" | "ticker"; running: boolean };
      return Promise.resolve({
        ...simulationState,
        [input.name]: { available: true, running: input.running }
      });
    }
    if (path === "/api/admin/simulation-controls") return Promise.resolve(simulationState);
    return Promise.reject(new Error(`Unexpected API request: ${path}`));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("admin workspace", () => {
  it("shows platform statistics, updates user roles, controls simulations, and filters audit events", async () => {
    renderAdmin();

    expect(await screen.findByText("Registered users")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("Trader")).toBeTruthy();
    expect(await screen.findByText("ORDER_ACCEPTED")).toBeTruthy();
    expect(await screen.findByText("Market-maker bot")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Make admin" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      `/api/admin/users/${listedUser.id}/role`,
      expect.anything(),
      "admin-token",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "admin" }) })
    ));

    fireEvent.click(screen.getByRole("button", { name: "Pause Market-maker bot" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/admin/simulation-controls",
      expect.anything(),
      "admin-token",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "marketMaker", running: false }) })
    ));

    fireEvent.change(screen.getByLabelText("Event type"), { target: { value: "ORDER_ACCEPTED" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      expect.stringContaining("eventType=ORDER_ACCEPTED"),
      expect.anything(),
      "admin-token"
    ));
  });

  it("does not render administrative data for a non-admin user", () => {
    useAuthMock.mockReturnValue({ token: "user-token", user: { ...currentUser, role: "user" } });
    renderAdmin();
    expect(screen.getByRole("alert").textContent).toContain("Administrator authentication is required.");
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("uploads a dropped CSV and reports its processed-row summary", async () => {
    class SuccessfulXhr extends EventTarget {
      upload = new EventTarget();
      status = 200;
      responseText = JSON.stringify({ imported: 3 });

      open(): void {}
      setRequestHeader(): void {}
      send(): void {
        const progress = Object.assign(new Event("progress"), { lengthComputable: true, loaded: 50, total: 100 });
        this.upload.dispatchEvent(progress);
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
    }
    vi.stubGlobal("XMLHttpRequest", SuccessfulXhr);
    renderAdmin();
    const file = new File(["symbol,name,sector,tick_size,last_price"], "instruments.csv", { type: "text/csv" });
    fireEvent.drop(screen.getByText("Drop a CSV file here").parentElement!, {
      dataTransfer: { files: [file] }
    });
    fireEvent.click(screen.getByRole("button", { name: "Import instruments" }));

    expect(await screen.findByText("Import complete: 3 instrument rows processed.")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });
});

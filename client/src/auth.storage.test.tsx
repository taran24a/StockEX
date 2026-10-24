import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn()
}));

vi.mock("./api", () => ({
  apiRequest: apiRequestMock,
  ApiClientError: class ApiClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
}));

const user = {
  id: "8af8401d-00c7-49f0-aeae-914c82dbdd72",
  email: "trader@example.com",
  displayName: "Trader",
  role: "user"
};

function AuthProbe() {
  const { token, user: currentUser, error, signIn, signOut } = useAuth();
  return (
    <>
      <p>{token === null ? "No in-memory token" : "In-memory token available"}</p>
      <p>{currentUser?.displayName ?? "Signed out"}</p>
      {error !== null && <p role="alert">{error}</p>}
      <button onClick={() => void signIn({ email: user.email, password: "practice-password" })}>Sign in test</button>
      <button onClick={signOut}>Sign out test</button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AuthProvider browser storage fallback", () => {
  it("keeps a successful session in memory when sessionStorage reads, writes, and removes throw", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage is disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage is disabled");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("Storage is disabled");
    });
    apiRequestMock.mockImplementation((path: string) => Promise.resolve(
      path === "/api/auth/login"
        ? { token: "memory-token", expiresAt: "2027-10-25T00:00:00.000Z", user }
        : { user, avatarUrl: null }
    ));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(await screen.findByText("Signed out")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in test" }));

    expect(await screen.findByText("In-memory token available")).toBeTruthy();
    expect(await screen.findByText("Trader")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be saved/i);
    expect(apiRequestMock).toHaveBeenCalledWith("/api/auth/me", expect.anything(), "memory-token");

    fireEvent.click(screen.getByRole("button", { name: "Sign out test" }));
    expect(screen.getByText("No in-memory token")).toBeTruthy();
  });
});

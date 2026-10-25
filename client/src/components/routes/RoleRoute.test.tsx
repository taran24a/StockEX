import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RoleRoute } from "./RoleRoute";

const useAuthMock = vi.hoisted(() => vi.fn());
vi.mock("../../auth", () => ({ useAuth: useAuthMock }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RoleRoute", () => {
  it("shows a forbidden page to authenticated non-admin users", () => {
    useAuthMock.mockReturnValue({
      ready: true,
      user: { id: "user", role: "user" }
    });
    render(
      <MemoryRouter>
        <RoleRoute role="admin"><p>Admin content</p></RoleRoute>
      </MemoryRouter>
    );
    expect(screen.getByText("403 · Forbidden")).toBeTruthy();
    expect(screen.queryByText("Admin content")).toBeNull();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "./AuthForm";

afterEach(cleanup);

describe("AuthForm", () => {
  it("submits validated login details", async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    const onRegister = vi.fn().mockResolvedValue(undefined);
    render(<AuthForm onLogin={onLogin} onRegister={onRegister} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "trader@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith({
      email: "trader@example.com",
      password: "a-strong-password"
    }));
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("shows validation feedback and does not submit an invalid registration", async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    const onRegister = vi.fn().mockResolvedValue(undefined);
    render(<AuthForm onLogin={onLogin} onRegister={onRegister} />);

    fireEvent.click(screen.getByRole("button", { name: /create an account/i }));
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "trader@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onRegister).not.toHaveBeenCalled();
  });
});

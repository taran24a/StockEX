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

  it("shows loading status and disables the submit action while login is in flight", async () => {
    let finishLogin: (() => void) | undefined;
    const onLogin = vi.fn(() => new Promise<void>((resolve) => {
      finishLogin = resolve;
    }));
    render(<AuthForm onLogin={onLogin} onRegister={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "trader@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const submit = await screen.findByRole("button", { name: "Please wait…" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/checking your details/i);
    fireEvent.click(submit);
    expect(onLogin).toHaveBeenCalledTimes(1);

    finishLogin?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(false));
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

    expect(await screen.findByText(/at least 12/i)).toBeTruthy();
    expect(screen.getByLabelText("Display name").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe("true");
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("shows email, display name, and password errors on their fields", async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    const onRegister = vi.fn().mockResolvedValue(undefined);
    render(<AuthForm initialMode="register" onLogin={onLogin} onRegister={onRegister} />);

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect((await screen.findByLabelText("Display name")).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(3);
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("toggles password visibility accessibly", () => {
    render(<AuthForm onLogin={vi.fn()} onRegister={vi.fn()} />);
    const password = screen.getByLabelText("Password");

    expect(password.getAttribute("type")).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password.getAttribute("type")).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("fills the seeded demo account without submitting", () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(<AuthForm onLogin={onLogin} onRegister={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Try demo account" }));

    expect((screen.getByLabelText("Email") as HTMLInputElement).value.length).toBeGreaterThan(0);
    expect((screen.getByLabelText("Password") as HTMLInputElement).value.length).toBeGreaterThan(0);
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("offers strength guidance during registration without blocking the schema-valid password", () => {
    render(<AuthForm initialMode="register" onLogin={vi.fn()} onRegister={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "just-a-few" } });
    expect(screen.getByText("Weak")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Password strength" }).getAttribute("aria-valuenow")).toBe("1");

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "valid-password" } });
    expect(screen.getByText("Fair")).toBeTruthy();
    expect(screen.getByText(/72 UTF-8 bytes/)).toBeTruthy();
  });
});

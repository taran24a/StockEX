import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TradeWiseLogo } from "./TradeWiseLogo";

afterEach(cleanup);

describe("TradeWiseLogo", () => {
  it("renders the custom T/W market mark with the wordmark", () => {
    const { container } = render(<TradeWiseLogo />);
    const icon = container.querySelector("svg");

    expect(container.textContent).toBe("TradeWise");
    expect(icon?.getAttribute("viewBox")).toBe("0 0 48 48");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.querySelectorAll("path").length).toBe(4);
  });

  it("supports a compact icon-only variant", () => {
    const { container } = render(<TradeWiseLogo iconOnly />);

    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelector(".tradewise-logo-wordmark")).toBeNull();
    expect(screen.queryByText("TradeWise")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { canTransitionOrderStatus, OrderStatusTransitions } from "../src/index.js";

describe("order status transitions", () => {
  it("allows only the declared forward transitions", () => {
    expect(canTransitionOrderStatus("pending", "open")).toBe(true);
    expect(canTransitionOrderStatus("open", "partially_filled")).toBe(true);
    expect(canTransitionOrderStatus("partially_filled", "filled")).toBe(true);
    expect(canTransitionOrderStatus("pending", "filled")).toBe(false);
    expect(canTransitionOrderStatus("filled", "cancelled")).toBe(false);
    expect(canTransitionOrderStatus("cancelled", "open")).toBe(false);
  });

  it("keeps terminal statuses without outgoing transitions", () => {
    expect(OrderStatusTransitions.filled).toEqual([]);
    expect(OrderStatusTransitions.cancelled).toEqual([]);
    expect(OrderStatusTransitions.rejected).toEqual([]);
  });
});

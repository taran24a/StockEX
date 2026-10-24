import { EventEmitter } from "node:events";
import type { Quote } from "@tradewise/shared";

type EventPayloads = {
  quote: [quote: Quote];
  order: [event: {
    id: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }];
  fill: [fill: {
    fill: {
      symbol: string;
      makerOrderId: string;
      takerOrderId: string;
      pricePaise: number;
      quantity: number;
    };
    fillId: string;
    makerAccountId: string;
    takerAccountId: string;
    makerFeePaise: number;
    takerFeePaise: number;
  }];
};

class TypedEventBus extends EventEmitter {
  override on<K extends keyof EventPayloads>(event: K, listener: (...args: EventPayloads[K]) => void): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof EventPayloads>(event: K, ...args: EventPayloads[K]): boolean {
    return super.emit(event, ...args);
  }
}

export const eventBus = new TypedEventBus();

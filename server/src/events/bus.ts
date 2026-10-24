import { EventEmitter } from "node:events";
import type { Quote } from "@tradewise/shared";

type EventPayloads = {
  quote: [quote: Quote];
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

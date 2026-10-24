import { DomainEventSchema } from "@tradewise/shared";
import type { DomainEvent } from "@tradewise/shared";

export function parseDomainEvent(value: unknown): DomainEvent {
  return DomainEventSchema.parse(value);
}

import {
  context,
  propagation,
  type Context,
  type BaggageEntry,
} from '@opentelemetry/api';

function toBaggageEntries(
  entries: Record<string, unknown>,
): Record<string, BaggageEntry> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [key, { value: String(value) }]),
  );
}

export function fromBaggageEntries(
  entries: Array<[key: string, BaggageEntry]>,
): Record<string, unknown> {
  return Object.fromEntries(entries.map(([key, value]) => [key, value.value]));
}

export function injectTraceContext<T extends Record<string, unknown>>(
  carrier?: T,
  baggage: Record<string, unknown> = {},
): T {
  const newCarrier = carrier ? { ...carrier } : {};

  try {
    const bag = propagation.createBaggage(toBaggageEntries(baggage));
    const ctx = propagation.setBaggage(context.active(), bag);

    propagation.inject(ctx, newCarrier);
  } catch {
    // If tracing is disabled or context is empty, do nothing
  }
  return newCarrier as T;
}

export function extractTraceContext(carrier: Record<string, unknown>): Context {
  try {
    return propagation.extract(context.active(), carrier);
  } catch {
    // If tracing is disabled or context cannot be extracted, return current context
    return context.active();
  }
}

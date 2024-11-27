// propagation.ts

import { context, propagation, type Context } from '@opentelemetry/api';

export function injectTraceContext<T extends Record<string, unknown>>(carrier?: T): T {
  const newCarrier = carrier ? { ...carrier } : {};
  try {
    propagation.inject(context.active(), newCarrier);
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

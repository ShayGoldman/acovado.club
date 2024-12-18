// @modules/tracing/src/tracer.ts

import type { Attributes, Span } from '@opentelemetry/api';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { makeTracingLogger } from './logger';
import { extractTraceContext } from './propagation';
import type { Context as ContextType, Tracer, TracerOptions } from './types';

export function makeTracer(options: TracerOptions): Tracer {
  const { serviceName, exporterUrl, logger } = options;

  const tracerProvider = new NodeTracerProvider({
    resource: new Resource({
      'service.name': serviceName,
    }),

    spanProcessors: exporterUrl
      ? [new BatchSpanProcessor(new OTLPTraceExporter({ url: exporterUrl }))]
      : [],
  });

  tracerProvider.register({
    contextManager: new AsyncLocalStorageContextManager(),
    propagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  });

  const otelTracer = tracerProvider.getTracer(serviceName);

  function makeContext(span: Span): ContextType {
    const tracingLogger = makeTracingLogger(logger, span);
    const container = { annotations: new Map<string, string | number | boolean>() };

    return {
      with: withSpan,
      log: tracingLogger,
      annotations: container.annotations,
      // TODO add anotate object support (Date -> ISOString)
      annotate(key: string, value: string | number | boolean): void {
        container.annotations = container.annotations.set(key, value);
        span.setAttribute(key, value);
        tracingLogger.setBindings({ [key]: value });
      },
      setName(name: string) {
        try {
          span.updateName(name);
        } catch (error: any) {
          span.recordException(error);
        }
      },
    };
  }

  // Overloaded function signatures for Tracer's with function
  async function withSpan<T>(
    name: string,
    fn: (context: ContextType) => Promise<T>,
  ): Promise<T>;
  async function withSpan<T>(
    name: string,
    opts: { attributes?: Attributes; headers?: any; attach?: boolean },
    fn: (context: ContextType) => Promise<T>,
  ): Promise<T>;
  // Implementation
  async function withSpan<T>(name: string, optsOrFn: any, maybeFn?: any): Promise<T> {
    let opts: { attributes?: Attributes; headers?: any; attach?: boolean } = {};
    let fn: (context: ContextType) => Promise<T>;

    if (typeof optsOrFn === 'function') {
      // Signature: with(name, fn)
      fn = optsOrFn;
    } else {
      // Signature: with(name, opts, fn)
      opts = optsOrFn;
      fn = maybeFn;
    }

    const { attributes, headers } = opts;
    let parentContext = context.active();

    if (headers) {
      const extractedContext = extractTraceContext(headers);

      if (extractedContext) {
        parentContext = extractedContext;
      }
    }

    const span = otelTracer.startSpan(name, { attributes }, parentContext);

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const ctx = makeContext(span);
        const result = await fn(ctx);
        return result;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  return {
    with: withSpan,
  };
}

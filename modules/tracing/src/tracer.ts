// @modules/tracing/src/tracer.ts

import type { Attributes, Span } from '@opentelemetry/api';
import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { Logger as OtelLogger } from '@opentelemetry/api-logs';
import { logs } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { makeTracingLogger } from './logger';
import { extractTraceContext } from './propagation';
import type { Context as ContextType, Tracer, TracerOptions } from './types';

export function makeTracer(options: TracerOptions): Tracer {
  const {
    serviceName,
    exporterUrls,
    logger,
    logExporterUrls,
    logExportEnabled = true,
  } = options;

  const resource = new Resource({
    'service.name': serviceName,
  });

  const spanProcessors = exporterUrls.map(
    (url) => new BatchSpanProcessor(new OTLPTraceExporter({ url })),
  );

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors,
  });

  tracerProvider.register({
    contextManager: new AsyncLocalStorageContextManager(),
    propagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  });

  const otelTracer = tracerProvider.getTracer(serviceName);
  const otelLogger = logExportEnabled
    ? makeOtelLogger(resource, logExporterUrls ?? exporterUrls, serviceName)
    : undefined;

  function makeContext(span: Span): ContextType {
    const tracingLogger = makeTracingLogger(logger, span, otelLogger);
    const container = {
      annotations: new Map<string, string | number | boolean>(),
    };

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

    const span = otelTracer.startSpan(
      name,
      attributes ? { attributes } : {},
      parentContext,
    );

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

function makeOtelLogger(
  resource: Resource,
  exporterUrls: string[],
  serviceName: string,
): OtelLogger {
  const loggerProvider = new LoggerProvider({ resource });

  for (const url of exporterUrls) {
    // Convert trace URLs to log URLs (e.g., /v1/traces -> /v1/logs)
    const logUrl = url.replace(/\/v1\/traces\/?$/, '/v1/logs');
    const exporter = new OTLPLogExporter({ url: logUrl });
    loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(exporter));
  }

  logs.setGlobalLoggerProvider(loggerProvider);
  return loggerProvider.getLogger(serviceName);
}

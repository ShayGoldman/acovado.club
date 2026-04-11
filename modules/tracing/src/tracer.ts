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
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
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
    deploymentEnvironment = process.env.NODE_ENV ?? 'development',
    traceSampleRatio = 1,
  } = options;

  const resource = new Resource({
    'service.name': serviceName,
    'deployment.environment': deploymentEnvironment,
  });

  const spanProcessors = exporterUrls.map(
    (url) => new BatchSpanProcessor(new OTLPTraceExporter({ url })),
  );

  const clampedRatio = Math.min(1, Math.max(0, traceSampleRatio));
  const sampler =
    clampedRatio >= 1
      ? undefined
      : new ParentBasedSampler({
          root: new TraceIdRatioBasedSampler(clampedRatio),
        });

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors,
    ...(sampler ? { sampler } : {}),
  });

  tracerProvider.register({
    contextManager: new AsyncLocalStorageContextManager(),
    propagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  });

  const otelTracer = tracerProvider.getTracer(serviceName);

  let loggerProvider: LoggerProvider | undefined;
  let otelLogger: OtelLogger | undefined;
  if (logExportEnabled) {
    const pipeline = makeOtelLogger(
      resource,
      logExporterUrls ?? exporterUrls,
      serviceName,
    );
    otelLogger = pipeline.otelLogger;
    loggerProvider = pipeline.loggerProvider;
  }

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
        } catch (error: unknown) {
          span.recordException(error as Error);
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
    opts: {
      attributes?: Attributes;
      headers?: any;
      attach?: boolean;
      links?: Array<{
        context: import('@opentelemetry/api').SpanContext;
        attributes?: Attributes;
      }>;
    },
    fn: (context: ContextType) => Promise<T>,
  ): Promise<T>;
  // Implementation
  async function withSpan<T>(name: string, optsOrFn: any, maybeFn?: any): Promise<T> {
    let opts: {
      attributes?: Attributes;
      headers?: any;
      attach?: boolean;
      links?: Array<{
        context: import('@opentelemetry/api').SpanContext;
        attributes?: Attributes;
      }>;
    } = {};
    let fn: (context: ContextType) => Promise<T>;

    if (typeof optsOrFn === 'function') {
      // Signature: with(name, fn)
      fn = optsOrFn;
    } else {
      // Signature: with(name, opts, fn)
      opts = optsOrFn;
      fn = maybeFn;
    }

    const { attributes, headers, attach = true, links } = opts;
    let parentContext = context.active();
    let extractedContext: import('@opentelemetry/api').Context | undefined;

    // Only extract context from headers if attach is true
    // When attach is false, we want siblings, so we don't use extracted context as parent
    if (headers && attach) {
      extractedContext = extractTraceContext(headers);

      if (extractedContext) {
        parentContext = extractedContext;
      }
    }

    // When attach is false, we want sibling spans (same parent as current span)
    // When attach is true, use current active context as parent (nested spans)
    let spanParentContext = parentContext;

    if (!attach) {
      // To create a sibling span, we need to use the same parent as the producer span
      // Since we don't have access to the producer's parent, we use root context
      // The span link (passed via links parameter) will connect the spans in the trace view
      // This creates siblings instead of parent-child relationships
      // Use root context by not setting any span in the context
      // This ensures the new span is not nested under the current active span
      spanParentContext = context.active();
      // Remove any active span from the context to create a root-level span
      const activeSpan = trace.getSpan(spanParentContext);
      if (activeSpan) {
        // Get the context without the active span
        spanParentContext = trace.deleteSpan(spanParentContext);
      }
    }

    // Build span options with links if provided
    const spanOptions: {
      attributes?: Attributes;
      links?: Array<{
        context: import('@opentelemetry/api').SpanContext;
        attributes?: Attributes;
      }>;
    } = {};

    if (attributes) {
      spanOptions.attributes = attributes;
    }

    if (links && links.length > 0) {
      spanOptions.links = links;
    }

    const span = otelTracer.startSpan(name, spanOptions, spanParentContext);

    // When attach is false, don't set span as active for children (creates siblings)
    // When attach is true, set span as active (creates nested children)
    const executionContext = attach
      ? trace.setSpan(context.active(), span)
      : context.active();

    return context.with(executionContext, async () => {
      try {
        const ctx = makeContext(span);
        const result = await fn(ctx);
        return result;
      } catch (error: unknown) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async function shutdown(): Promise<void> {
    try {
      if (loggerProvider) {
        await loggerProvider.shutdown();
      }
    } finally {
      await tracerProvider.shutdown();
    }
  }

  return {
    with: withSpan,
    shutdown,
  };
}

function makeOtelLogger(
  resource: Resource,
  exporterUrls: string[],
  serviceName: string,
): { otelLogger: OtelLogger; loggerProvider: LoggerProvider } {
  const loggerProvider = new LoggerProvider({ resource });

  for (const url of exporterUrls) {
    // Convert trace URLs to log URLs (e.g., /v1/traces -> /v1/logs)
    const logUrl = url.replace(/\/v1\/traces\/?$/, '/v1/logs');
    const exporter = new OTLPLogExporter({ url: logUrl });
    loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(exporter));
  }

  logs.setGlobalLoggerProvider(loggerProvider);
  return {
    otelLogger: loggerProvider.getLogger(serviceName),
    loggerProvider,
  };
}

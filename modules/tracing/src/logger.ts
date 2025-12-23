import util from 'util';
import type { Logger } from '@modules/logger';
import { context, trace } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import type { Logger as OtelLogger } from '@opentelemetry/api-logs';
import { SeverityNumber } from '@opentelemetry/api-logs';

export function makeTracingLogger(
  logger: Logger,
  span: Span,
  otelLogger?: OtelLogger,
): Logger {
  const levels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

  const tracingLogger = logger.child({});

  for (const level of levels) {
    tracingLogger[level] = (...args: any[]) => {
      const severity = levelToSeverity(level);
      const { message, attributes } = parseLogArgs(args);
      const flattenedAttributes = flattenObject(attributes);
      const spanEventPayload = Object.fromEntries(
        Object.entries(flattenedAttributes).filter(([key]) => key !== 'name'),
      );

      if (span && typeof span.addEvent === 'function') {
        span.addEvent(message, spanEventPayload);
      }

      if (otelLogger && severity) {
        // Get the active span from context (could be a child span)
        const activeSpan = trace.getActiveSpan();
        const spanToLink = activeSpan || span;

        if (spanToLink) {
          const spanContext = spanToLink.spanContext();
          const linkedAttributes = {
            ...spanEventPayload,
            'span.link.trace_id': spanContext.traceId,
            'span.link.span_id': spanContext.spanId,
          };

          // Use the active context which already has the correct span set
          const activeContext = context.active();
          otelLogger.emit({
            body: message,
            attributes: linkedAttributes,
            severityNumber: severity.number,
            severityText: severity.text,
            context: activeContext,
          });
        }
      }

      (logger as any)[level](...args);
    };
  }

  return tracingLogger;
}

function levelToSeverity(
  level: string,
): { number: SeverityNumber; text: string } | undefined {
  switch (level) {
    case 'fatal':
      return { number: SeverityNumber.FATAL, text: 'FATAL' };
    case 'error':
      return { number: SeverityNumber.ERROR, text: 'ERROR' };
    case 'warn':
      return { number: SeverityNumber.WARN, text: 'WARN' };
    case 'info':
      return { number: SeverityNumber.INFO, text: 'INFO' };
    case 'debug':
      return { number: SeverityNumber.DEBUG, text: 'DEBUG' };
    case 'trace':
      return { number: SeverityNumber.TRACE, text: 'TRACE' };
    default:
      return undefined;
  }
}

/**
 * Flattens a nested object into a flat object with dot-notation keys
 * @param obj The object to flatten
 * @param prefix Optional prefix for nested keys (used in recursive calls)
 * @returns A flat object with dot-notation keys
 */
function flattenObject(obj: Record<string, any>, prefix = ''): Record<string, any> {
  return Object.keys(obj).reduce((acc, key) => {
    const prefixedKey = prefix ? `${prefix}.${key}` : key;

    // If the value is an object (but not null, and not an array)
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      // Recursively flatten nested objects
      return {
        ...acc,
        ...flattenObject(obj[key], prefixedKey),
      };
    }

    // For non-object values or arrays, add to the accumulator
    return {
      ...acc,
      [prefixedKey]: obj[key],
    };
  }, {});
}

function parseLogArgs(args: any[]): { message: string; attributes: Record<string, any> } {
  let message = '';
  let attributes: Record<string, any> = {};

  if (args.length === 0) {
    return { message, attributes };
  }

  const firstArg = args[0];

  if (typeof firstArg === 'string') {
    // First argument is a message string
    if (args.length > 1) {
      // There are format arguments
      message = util.format(firstArg, ...args.slice(1));
    } else {
      message = firstArg;
    }
  } else if (typeof firstArg === 'object' && firstArg !== null) {
    // First argument is an object, could be context
    attributes = firstArg;

    if (args.length > 1 && typeof args[1] === 'string') {
      // Second argument is a message string
      if (args.length > 2) {
        // There are format arguments
        message = util.format(args[1], ...args.slice(2));
      } else {
        message = args[1];
      }
    } else {
      // No message string; serialize the object as message
      message = JSON.stringify(firstArg);
    }
  } else {
    // First argument is something else
    message = String(firstArg);
  }

  return { message, attributes };
}

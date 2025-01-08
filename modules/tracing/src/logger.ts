import util from 'util';
import type { Logger } from '@modules/logger';
import type { Span } from '@opentelemetry/api';

export function makeTracingLogger(logger: Logger, span: Span): Logger {
  const levels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

  const tracingLogger = logger.child({});

  for (const level of levels) {
    tracingLogger[level] = (...args: any[]) => {
      // TODO find a way to add bindings to the logger
      // Log the message using the original logger
      (logger as any)[level](...args);

      // Process args to extract message and attributes
      const { message, attributes } = parseLogArgs(args);
      const spanEventPayload = { ...flattenObject(attributes), _msg: message };
      // Add an event to the tracing span
      if (span && typeof span.addEvent === 'function') {
        span.addEvent(message, spanEventPayload);
      }
    };
  }

  return tracingLogger;
}

/**
 * Flattens a nested object into a flat object with dot-notation keys
 * @param obj The object to flatten
 * @param prefix Optional prefix for nested keys (used in recursive calls)
 * @returns A flat object with dot-notation keys
 */
function flattenObject(
  obj: Record<string, any>,
  prefix: string = '',
): Record<string, any> {
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

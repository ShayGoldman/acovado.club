import util from 'util';
import type { Logger } from '@modules/logger';
import type { Span } from '@opentelemetry/api';

export function makeTracingLogger(logger: Logger, span: Span): Logger {
  const levels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

  const tracingLogger = Object.create(logger);

  for (const level of levels) {
    tracingLogger[level] = (...args: any[]) => {
      // Log the message using the original logger
      (logger as any)[level](...args);

      // Process args to extract message and attributes
      const { message, attributes } = parseLogArgs(args);

      // Add an event to the tracing span
      if (span && typeof span.addEvent === 'function') {
        span.addEvent(level, { message, ...attributes });
      }
    };
  }

  return tracingLogger;
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

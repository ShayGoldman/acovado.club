import pino, { type Level } from 'pino';

export type Logger = ReturnType<typeof pino>;

export interface LoggerOpts {
  name: string;
  level?: Level;
  bindings?: Record<string, any>;
  /** Defaults to true when NODE_ENV is not `production` (human-readable local output). */
  pretty?: boolean;
}

const MAX_MESSAGE = 200;
const MAX_STACK = 2048;
const MAX_CAUSE_DEPTH = 3;
const SAFE_FIELDS = ['code', 'errno', 'syscall', 'statusCode', 'status'] as const;

export function boundedErrSerializer(err: unknown, depth = 0): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { name: 'NonError', message: String(err).slice(0, MAX_MESSAGE) };
  }

  // Past the depth cap, emit minimal shape only — no stack, no further recursion.
  if (depth > MAX_CAUSE_DEPTH) {
    return { name: err.name, message: err.message.slice(0, MAX_MESSAGE) };
  }

  const result: Record<string, unknown> = {
    name: err.name,
    message: err.message.slice(0, MAX_MESSAGE),
  };

  if (err.stack) {
    result['stack'] = err.stack.slice(0, MAX_STACK);
  }

  for (const field of SAFE_FIELDS) {
    const val = (err as unknown as Record<string, unknown>)[field];
    if (val !== undefined) {
      result[field] = val;
    }
  }

  if (err.cause !== undefined) {
    result['cause'] = boundedErrSerializer(err.cause, depth + 1);
  }

  return result;
}

export function makeLogger(opts: LoggerOpts): Logger {
  const usePrettyTransport = opts.pretty ?? process.env.NODE_ENV !== 'production';

  return pino({
    name: opts.name,
    level: opts.level || 'info',
    base: opts.bindings || {},

    serializers: {
      err: boundedErrSerializer,
      error: boundedErrSerializer,
    },

    ...(usePrettyTransport
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              ignore: 'pid,hostname',
              colorize: true,
            },
          },
        }
      : {}),
  });
}

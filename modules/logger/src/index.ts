import { pino } from 'pino';

export type Logger = ReturnType<typeof pino>;

export interface LoggerOpts {
  name: string;
  level?: pino.Level;
  bindings?: Record<string, any>;
  /** Defaults to true when NODE_ENV is not `production` (human-readable local output). */
  pretty?: boolean;
}

export function makeLogger(opts: LoggerOpts): Logger {
  const usePrettyTransport = opts.pretty ?? process.env.NODE_ENV !== 'production';

  return pino({
    name: opts.name,
    level: opts.level || 'info',
    base: opts.bindings || {},

    serializers: {
      err: pino.stdSerializers.errWithCause,
      error: pino.stdSerializers.errWithCause,
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

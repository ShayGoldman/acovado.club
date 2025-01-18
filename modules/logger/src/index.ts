import { pino } from 'pino';

export type Logger = ReturnType<typeof pino>;

export interface LoggerOpts {
  name: string;
  level?: pino.Level;
  bindings?: Record<string, any>;
}

export function makeLogger(opts: LoggerOpts): Logger {
  return pino({
    name: opts.name,
    level: opts.level || 'info',
    base: opts.bindings || {},

    serializers: {
      err: pino.stdSerializers.errWithCause,
      error: pino.stdSerializers.errWithCause,
    },

    transport: {
      target: 'pino-pretty',
      options: {
        ignore: 'pid,hostname',
        colorize: true,
      },
    },
  });
}

import { pino } from 'pino';

export type Logger = ReturnType<typeof pino>;

export interface LoggerOpts {
  name: string;
}

export function makeLogger(opts: LoggerOpts): Logger {
  return pino({
    name: opts.name,
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

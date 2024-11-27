import { pino } from 'pino';

export type Logger = ReturnType<typeof pino>;

export function makeLogger(): Logger {
  return pino({
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  });
}

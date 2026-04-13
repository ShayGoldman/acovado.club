import type { Logger } from '@modules/logger';
import nodeCron from 'node-cron';

export interface MakeCronRunnerOpts {
  expression: string;
  logger: Logger;
  onTick: () => Promise<void>;
}

export type CronRunner = ReturnType<typeof makeCronRunner>;

export function makeCronRunner({ expression, logger, onTick }: MakeCronRunnerOpts) {
  let running = false;
  let task: nodeCron.ScheduledTask | null = null;

  async function tick(): Promise<void> {
    if (running) {
      logger.warn({ expression }, 'cron.tick.skipped: previous tick still running');
      return;
    }
    running = true;
    try {
      await onTick();
    } catch (err) {
      logger.error({ err }, 'cron.tick.error');
    } finally {
      running = false;
    }
  }

  function start(): void {
    task = nodeCron.schedule(expression, () => {
      void tick();
    });
    logger.info({ expression }, 'cron.started');
  }

  function stop(): void {
    task?.stop();
    task = null;
    logger.info({ expression }, 'cron.stopped');
  }

  return { start, stop };
}

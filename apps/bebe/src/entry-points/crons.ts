import { makeWatchListCollectionService } from '@/collection/watch-list-collection.service';
import type { Environment } from '@/env';
import type { DBClient } from '@modules/db';
import type { Producer } from '@modules/events';
import type { Tracer } from '@modules/tracing';
import { CronJob } from 'cron';

export interface MakeCronJobsServiceOpts {
  db: DBClient;
  tracer: Tracer;
  producer: Producer;
  env: Environment;
}

export async function makeCronJobsService(opts: MakeCronJobsServiceOpts) {
  const { tracer } = opts;

  const crons = await tracer.with('Initializing Cron Jobs', async (c) => {
    c.log.info('Initializing Cron Jobs');

    const crons = [
      {
        name: 'Watch Lists collection',
        job: new CronJob(
          '*/30 * 14-22 * * *',
          makeWatchListCollectionService(opts).collectWatchLists,
          null,
          null,
          null,
          null,
          opts.env.CRONS_START_ON_INIT,
        ),
      },
    ] as const;

    c.log.debug('Cron jobs initialized');

    return crons;
  });

  return {
    async start() {
      for (const { job, name } of crons) {
        await tracer.with('Starting Cron jobs', async (c) => {
          c.log.info(`Starting Cron Job: ${name}`);
        });
        job.start();
      }
    },

    async stop() {
      for (const { job, name } of crons) {
        await tracer.with('Stoping Cron jobs', async (c) => {
          c.log.info(`Stoping Cron Job: ${name}`);
        });
        job.stop();
      }
    },
  };
}

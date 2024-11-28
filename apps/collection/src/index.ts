import Env from '@/env';
import {
  makeConsumer,
  type Message,
  type BasePayload,
  type EventHandler,
} from '@modules/events';
import { makeLogger } from '@modules/logger';

import { makeMigrateDB, type Ticker } from '@modules/db';
import { makeTracer } from '@modules/tracing';
import { makeDB } from './db';
import type { Identified } from '@modules/types';

const logger = makeLogger({
  name: 'bebe',
});

const migrate = makeMigrateDB({
  url: Env.DATABASE_URL,
  logger,
});

await migrate();
const tracer = makeTracer({
  serviceName: 'bebe',
  exporterUrl: Env.TRACE_EXPORTER_URL,
  logger,
});
const db = makeDB({
  url: Env.DATABASE_URL,
});

const consumers = makeConsumer({
  broker: Env.BROKER_URL,
  logger,
  tracing: { tracer },
  handlers: [
    {
      domain: 'collection',
      queue: 'collection.requested',
      // TODO need to type messages now
      onMessage: async (
        message: Message<BasePayload<Ticker, 'collection', 'collection.requested'>>,
        context,
      ) => {
        console.log(/* LOG */ '=====', 'message.payload', message.payload);
        context.log.info(message, 'Received message');
      },
    },
  ],
});

logger.info('Setting up...');
await consumers.connect();

logger.info('Starting...');

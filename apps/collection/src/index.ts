import { makeConsumer, makeProducer } from '@modules/events';
import { makeLogger } from '@modules/logger';

import { makeTracer } from '@modules/tracing';

const logger = makeLogger();

const producer = makeProducer({
  logger,
  broker: 'amqp://rabbit:rabbit@localhost:5672',
  tracing: {
    tracer: makeTracer({
      serviceName: 'producer',
      exporterUrl: 'http://localhost:4318/v1/traces',
      logger,
    }),
  },
});

// Consumer setup
const consumer = makeConsumer({
  logger,
  broker: 'amqp://rabbit:rabbit@localhost:5672',
  tracing: {
    tracer: makeTracer({
      serviceName: 'consumer',
      exporterUrl: 'http://localhost:4318/v1/traces',
      logger,
    }),
  },
  handlers: [
    {
      domain: 'tests',
      queue: 'all-tests',
      onMessage: async (message, c) => {
        c.log.info({ messageId: message.metadata.messageId }, 'Message received');

        c.with!('another-span', async (c) => {
          c.log.info({ messageId: message.metadata.messageId }, 'Another span');
        });
        console.log(
          /* LOG */ '=====',
          'message',
          message.metadata.messageId,
          message.metadata.queue,
        );
      },
    },
    {
      domain: 'tests',
      queue: 'some-tests',
      routingKey: 'tests.some',
      onMessage: async (message) => {
        console.log(
          /* LOG */ '=====',
          'message',
          message.metadata.messageId,
          message.metadata.queue,
        );
      },
    },
  ],
});

await producer.connect();
await consumer.connect();

await producer.send('tests', 'tests.all', [{ test: Math.random() }]);
await producer.send('tests', 'tests.some', [{ test: Math.random() }]);

// TODO make sure all logs are clean and with simple and readable context

// TODO find a convention for better queue readability in rabbit UI

# @modules/events

RabbitMQ **producer** and **consumer** helpers. Pass a **`Tracer`** from `@modules/tracing` to get spans around publish/consume (see `src/tracing-decorator.ts`).

## Usage

```typescript
const producer = makeProducer({
  logger,
  broker: 'amqp://rabbit:rabbit@localhost:5672',
  // Optional: tracing: { tracer },
});

// Consumer setup
const consumer = makeConsumer({
  logger,
  broker: 'amqp://rabbit:rabbit@localhost:5672',
  // Optional: tracing: { tracer },
  handlers: [
    {
      domain: 'tests',
      queue: 'all-tests',
      onMessage: async (message, c) => {},
    },
    {
      domain: 'tests',
      queue: 'some-tests',
      routingKey: 'tests.some',
      onMessage: async (message) => {},
    },
  ],
});

await producer.connect();
await consumer.connect();

await producer.send('tests', 'tests.all', [{ test: Math.random() }]);
await producer.send('tests', 'tests.some', [{ test: Math.random() }]);
```

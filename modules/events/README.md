# @modules/events

## Usage

```typescript
const producer = makeProducer({
  logger,
  broker: 'amqp://rabbit:rabbit@localhost:5672',
});

// Consumer setup
const consumer = makeConsumer({
  logger,
  broker: 'amqp://rabbit:rabbit@localhost:5672',
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

import { eq, schema, type Collection, type DBClient } from '@modules/db';
import type { BasePayload, Message, Producer } from '@modules/events';
import type { Context } from '@modules/tracing';
import { makeTickerCollectionService } from './ticker-collection.service';

export interface MakeOnCollectionCreatedServiceOpts {
  db: DBClient;
  producer: Producer;
}

export function makeOnCollectionCreatedService({
  db,
  producer,
}: MakeOnCollectionCreatedServiceOpts) {
  const tickerCollectionService = makeTickerCollectionService({ db, producer });
  return {
    async onCollectionCreated(
      message: Message<BasePayload<Collection, 'collection', 'collection.created'>>,
      c: Context,
    ) {
      const { data } = message.payload;
      const collectionData = data.data;

      c.log.debug(message, 'Received collection.created message');
      c.log.info(
        { 'collection.id': data.id, 'collection.type': data.type },
        'Processing collection.created message',
      );

      c.annotate('collection.id', data.id);
      c.annotate('collection.type', data.type);

      if (collectionData.type === 'ticker') {
        await tickerCollectionService.onTickerCollectionCreated(data, c);
      }

      c.log.info('Collection completed');
      await db
        .update(schema.collections)
        .set({
          status: 'completed',
        })
        .where(eq(schema.collections.id, data.id));
    },
  };
}

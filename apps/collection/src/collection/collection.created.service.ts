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
      ctx: Context,
    ) {
      const { data } = message.payload;
      const collectionData = data.data;

      ctx.log.debug(message, 'Received collection.created message');
      ctx.log.info(
        { 'collection.id': data.id, 'collection.type': data.type },
        'Processing collection.created message',
      );

      ctx.annotate('collection.id', data.id);
      ctx.annotate('collection.type', data.type);

      if (collectionData.type === 'ticker') {
        await ctx.with('Collecting data for ticker', (c) =>
          tickerCollectionService.onTickerCollectionCreated(data, c),
        );
      }

      ctx.log.info('Collection completed');
      await db
        .update(schema.collections)
        .set({
          status: 'completed',
        })
        .where(eq(schema.collections.id, data.id));
    },
  };
}

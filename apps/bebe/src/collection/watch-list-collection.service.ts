import { makeCollection, schema, type DBClient } from '@modules/db';
import { makeEvent, type Producer } from '@modules/events';
import type { Tracer } from '@modules/tracing';

export interface MakeWatchListCollectionServiceOpts {
  db: DBClient;
  tracer: Tracer;
  producer: Producer;
}

export function makeWatchListCollectionService(opts: MakeWatchListCollectionServiceOpts) {
  const { db, tracer, producer } = opts;

  return {
    async collectWatchLists() {
      const watchLists = await db.query.watchLists.findMany({
        with: {
          tickers: {
            with: {
              ticker: true,
            },
          },
        },
      });

      for (const watchList of watchLists) {
        await tracer.with(
          `Create collections for watch list ${watchList.name}`,
          async (c) => {
            c.annotate('watch-list.id', watchList.id);
            c.annotate('watch-list.name', watchList.name);

            for (const { ticker } of watchList.tickers) {
              c.log.info(
                { tickerId: ticker.id },
                `Creating collection for ticker ${ticker.name}`,
              );
              const [collection] = await db
                .insert(schema.collections)
                .values(
                  makeCollection({
                    status: 'pending',
                    type: 'ticker',
                    data: {
                      type: 'ticker',
                      tickerId: ticker.id,
                    },
                  }),
                )
                .returning();

              c.log.debug(
                { collectionId: collection.id },
                `Collection created for ticker ${ticker.name}`,
              );

              const event = makeEvent('collection', 'created', collection);
              c.with(`Created collection for: ${ticker.symbol}`, async () => {
                producer.send('collection', 'collection.created', event, {
                  baggage: { 'ticker.id': ticker.id },
                });
              });
            }
          },
        );
      }
    },
  };
}

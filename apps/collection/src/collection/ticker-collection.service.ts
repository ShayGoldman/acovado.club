import {
  makeSignalMetric,
  schema,
  type Collection,
  type DBClient,
  type SignalMetric,
} from '@modules/db';
import type { Context } from '@modules/tracing';
import { collectTickerData } from './ticker';
import { makeEvent, type Producer } from '@modules/events';

export interface MakeTickerCollectionServiceOpts {
  db: DBClient;
  producer: Producer;
}

export function makeTickerCollectionService({
  db,
  producer,
}: MakeTickerCollectionServiceOpts) {
  return {
    async onTickerCollectionCreated(collection: Collection, c: Context) {
      const collectionData = collection.data;
      if (collectionData.type !== 'ticker') {
        c.log.error('Invalid collection type');
        return;
      }

      c.annotate('ticker.id', collectionData.tickerId);
      c.log.debug({ collectionData }, 'Fetching ticker');

      const ticker = await db.query.tickers.findFirst({
        where: (w, { eq }) => eq(w.id, collectionData.tickerId),
      });

      if (!ticker) {
        c.log.error('Ticker not found');
        return;
      }

      c.annotate('ticker.name', ticker.name);
      c.annotate('ticker.symbol', ticker.symbol);
      c.setName(`Collecting ${ticker.name} ticker data`);

      const tickerData = await collectTickerData(ticker, c);

      if (!tickerData) {
        c.log.info(`No data found for ticker: ${ticker.name}`);
        return;
      }

      if (tickerData.marketState !== 'REGULAR') {
        c.log.info('Market is currently closed. Skipping');
        return;
      }

      c.log.info('Creating signals');

      const signalsData = [
        tickerData.regularMarketVolume &&
          makeSignalMetric({
            collectionId: collection.id,
            tickerId: ticker.id,
            type: 'volume',
            metric: Number(tickerData.regularMarketVolume.toFixed(4)).toString(),
          }),

        tickerData.regularMarketPrice &&
          makeSignalMetric({
            collectionId: collection.id,
            tickerId: ticker.id,
            type: 'price',
            metric: Number(tickerData.regularMarketPrice.toFixed(4)).toString(),
          }),
      ].filter(Boolean) as SignalMetric[];

      if (!signalsData.length) {
        return;
      }

      const signals = await db
        .insert(schema.signalMetrics)
        .values(signalsData)
        .returning();

      for (const signal of signals) {
        const event = makeEvent('signal', 'created', signal);
        producer.send('signal', event.type, event);
      }

      c.log.debug({ signals }, 'Signals created');
    },
  };
}

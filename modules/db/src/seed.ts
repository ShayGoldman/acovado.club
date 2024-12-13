import { makeLogger } from '@modules/logger';
import { reset, seed } from 'drizzle-seed';
import sample from 'lodash/sample';
import { makeDBClient } from './client';
import Env from './env';
import { makeWatchListToTicker } from './models';
import schema, { tickers, watchLists } from './schema';

const logger = makeLogger({ name: 'seed' });
const db = makeDBClient({
  url: Env.DATABASE_URL,
  logger: logger,
});

logger.info('Resetting all data');
await reset(db, schema);

logger.info('Seeding Tickers');
await seed(db, { tickers }, { seed: Date.now() }).refine((f) => ({
  tickers: {
    count: 3,
    columns: {
      symbol: f.valuesFromArray({ values: ['AAPL', 'GOOG', 'MSFT', 'AMZN', 'PANW'] }),
    },
  },
}));

logger.info('Seeding Watch Lists');
await seed(db, { watchLists }, { count: 2 });

const newTickers = await db.query.tickers.findMany();
const newWatchlists = await db.query.watchLists.findMany();

logger.info('Connecting Tickers to Watch Lists');
await db.insert(schema.watchListToTickers).values(
  newTickers.map((t) =>
    makeWatchListToTicker({
      watchListId: sample(newWatchlists.map((l) => l.id)) as string,
      tickerId: t.id,
    }),
  ),
);

logger.info('Done');

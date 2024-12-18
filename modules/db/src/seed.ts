import { makeLogger } from '@modules/logger';
import { reset } from 'drizzle-seed';
import { makeDBClient } from './client';
import Env from './env';
import { makeTicker, makeWatchList, makeWatchListToTicker } from './models';
import schema from './schema';

const logger = makeLogger({ name: 'seed' });
const db = makeDBClient({
  url: Env.DATABASE_URL,
  logger: logger,
});

logger.info('Resetting all data');
await reset(db, schema);

logger.info('Seeding Tickers');

logger.info('Seeding Watch Lists');

await db.transaction(async (tx) => {
  const [big7] = await tx
    .insert(schema.watchLists)
    .values(makeWatchList({ name: 'Magnificent Seven' }))
    .returning();
  const [quantum] = await tx
    .insert(schema.watchLists)
    .values(makeWatchList({ name: 'Quantum Computing' }))
    .returning();
  const [chips] = await tx
    .insert(schema.watchLists)
    .values(makeWatchList({ name: 'Chips' }))
    .returning();

  const big7Tickers = await tx
    .insert(schema.tickers)
    .values([
      makeTicker({ name: 'Nvidia', symbol: 'NVDA' }),
      makeTicker({ name: 'Amazon', symbol: 'AMZN' }),
      makeTicker({ name: 'Microsoft', symbol: 'MSFT' }),
      makeTicker({ name: 'Meta', symbol: 'META' }),
      makeTicker({ name: 'Alphabet', symbol: 'GOOGL' }),
      makeTicker({ name: 'Tesla', symbol: 'TSLA' }),
      makeTicker({ name: 'Apple', symbol: 'AAPL' }),
    ])
    .returning();

  const chipsTickers = await tx
    .insert(schema.tickers)
    .values([
      makeTicker({ name: 'Taiwan Semiconductor', symbol: 'TPE' }),
      makeTicker({ name: 'Intel', symbol: 'INTC' }),
      makeTicker({ name: 'Qualcomm', symbol: 'QCOM' }),
      makeTicker({ name: 'Broadcom', symbol: 'AVGO' }),
      makeTicker({ name: 'Synopsys', symbol: 'SNPS' }),
      makeTicker({ name: 'Advanced Micro Devices', symbol: 'AMD' }),
      makeTicker({ name: 'United Microelectronics Corporation', symbol: 'UMC' }),
      makeTicker({ name: 'Super Micro Computer', symbol: 'SMCI' }),
    ])
    .returning();

  const quantumTickers = await tx
    .insert(schema.tickers)
    .values([
      makeTicker({ name: 'Honeywell International', symbol: 'HON' }),
      makeTicker({ name: 'FormFactor', symbol: 'FORM' }),
      makeTicker({ name: 'IonQ', symbol: 'IONQ' }),
      makeTicker({ name: 'IBM', symbol: 'IBM' }),
      makeTicker({ name: 'Rigetti Computing', symbol: 'RGTI' }),
      makeTicker({ name: 'Quantum Computing', symbol: 'QUBT' }),
      makeTicker({ name: 'D-Wave Quantum', symbol: 'QBTS' }),
    ])
    .returning();

  const nvda = await tx.query.tickers.findFirst({
    where: (t, { eq }) => eq(t.symbol, 'NVDA'),
  });
  const microsoft = await tx.query.tickers.findFirst({
    where: (t, { eq }) => eq(t.symbol, 'MSFT'),
  });
  const google = await tx.query.tickers.findFirst({
    where: (t, { eq }) => eq(t.symbol, 'GOOGLE'),
  });

  logger.info('Connecting Tickers to Watch Lists');
  await tx.insert(schema.watchListToTickers).values(
    big7Tickers.map((t) =>
      makeWatchListToTicker({
        watchListId: big7.id,
        tickerId: t.id,
      }),
    ),
  );

  await tx.insert(schema.watchListToTickers).values(
    chipsTickers.map((t) =>
      makeWatchListToTicker({
        watchListId: chips.id,
        tickerId: t.id,
      }),
    ),
  );

  await tx.insert(schema.watchListToTickers).values(
    quantumTickers.map((t) =>
      makeWatchListToTicker({
        watchListId: quantum.id,
        tickerId: t.id,
      }),
    ),
  );

  if (nvda) {
    await tx.insert(schema.watchListToTickers).values([
      makeWatchListToTicker({
        watchListId: chips.id,
        tickerId: nvda.id,
      }),
      makeWatchListToTicker({
        watchListId: quantum.id,
        tickerId: nvda.id,
      }),
    ]);
  }

  if (google) {
    await tx.insert(schema.watchListToTickers).values([
      makeWatchListToTicker({
        watchListId: quantum.id,
        tickerId: google.id,
      }),
    ]);
  }

  if (microsoft) {
    await tx.insert(schema.watchListToTickers).values([
      makeWatchListToTicker({
        watchListId: quantum.id,
        tickerId: microsoft.id,
      }),
    ]);
  }
});

logger.info('Done');

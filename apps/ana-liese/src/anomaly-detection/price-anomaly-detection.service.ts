import { makeStory, schema, type DBClient, type SignalMetric } from '@modules/db';
import type { Context } from '@modules/tracing';

const alpha = 0.005; // Smoothing factor for ZLEMA
const consecutiveBreachLimit = 3; // Number of consecutive breaches required for price
const rollingWindow = 10; // Number of periods to calculate dynamic thresholds

export interface MakePriceAnomalyDetectionService {
  db: DBClient;
}

export function makePriceAnomalyDetectionService({
  db,
}: MakePriceAnomalyDetectionService) {
  function validateSignal(signal: SignalMetric, c: Context): boolean {
    if (signal.type !== 'price') {
      c.log.error('Invalid signal type');
      return false;
    }
    return true;
  }

  async function getState(symbol: string, c: Context) {
    c.log.debug({ symbol }, 'Fetching price state from database');

    const [lastZLEMA, breachCount, rollingStd] = await Promise.all([
      db.query.kvStore.findFirst({
        where: (store, { eq }) => eq(store.key, `${symbol}.price.lastZLEMA`),
      }),
      db.query.kvStore.findFirst({
        where: (store, { eq }) => eq(store.key, `${symbol}.price.breachCount`),
      }),
      db.query.kvStore.findFirst({
        where: (store, { eq }) => eq(store.key, `${symbol}.price.rollingStd`),
      }),
    ]);

    const parsed = {
      lastZLEMA: lastZLEMA?.value ? Number(lastZLEMA.value) : null,
      breachCount: breachCount?.value ? Number(breachCount.value) : 0,
      rollingStd: rollingStd?.value ? JSON.parse(rollingStd.value) : [],
    };

    c.log.debug({ symbol, parsed }, 'Fetched price state from database');
    return parsed;
  }

  function processSignal(
    state: {
      lastZLEMA: number | null;
      breachCount: number;
      rollingStd: number[];
    },
    currentPrice: number,
    c: Context,
  ): {
    spikeDetected: boolean;
    difference: number;
    result: {
      lastZLEMA: number;
      breachCount: number;
      rollingStd: number[];
    };
  } {
    let spikeDetected = false;
    let breachCount = state.breachCount;

    c.log.debug(
      { currentPrice, state },
      'Processing price signal with dynamic thresholds and z-score',
    );

    // Handle nullable fields with defaults
    const prevZLEMA = state.lastZLEMA ?? currentPrice; // Default to current price if null

    // ZLEMA Calculation
    const lag = 2 / (1 + alpha);
    const adjustedInput = currentPrice + (currentPrice - prevZLEMA) * lag;
    const lastZLEMA = alpha * adjustedInput + (1 - alpha) * prevZLEMA;

    c.log.debug({ adjustedInput, prevZLEMA, lastZLEMA }, 'Calculated new ZLEMA');

    // Calculate percentage difference and z-score
    const percentageDifference = (Math.abs(currentPrice - lastZLEMA) / lastZLEMA) * 100;

    // Update rolling standard deviation
    const updatedRollingStd = [
      ...state.rollingStd.slice(-rollingWindow + 1),
      percentageDifference,
    ];
    const mean = updatedRollingStd.reduce((a, b) => a + b, 0) / updatedRollingStd.length;
    const stdDev = Math.sqrt(
      updatedRollingStd.map((x) => (x - mean) ** 2).reduce((a, b) => a + b, 0) /
        updatedRollingStd.length,
    );
    const zScore = (percentageDifference - mean) / (stdDev || 1);

    c.log.debug(
      { percentageDifference, mean, stdDev, zScore },
      'Calculated dynamic threshold and z-score for price',
    );

    // Check thresholds
    if (percentageDifference > mean + stdDev && zScore > 2) {
      breachCount += 1;
      c.log.info({ percentageDifference, breachCount }, 'Threshold breached for price');
    } else {
      breachCount = 0;
    }

    // Detect sustained spike
    spikeDetected = breachCount >= consecutiveBreachLimit;
    if (spikeDetected) {
      c.log.info({ breachCount }, 'Sustained price spike detected');
      breachCount = 0; // Reset breach count after detection
    }

    return {
      spikeDetected,
      difference: currentPrice - prevZLEMA,
      result: {
        lastZLEMA,
        breachCount,
        rollingStd: updatedRollingStd,
      },
    };
  }

  async function saveState(
    symbol: string,
    state: {
      lastZLEMA: number;
      breachCount: number;
      rollingStd: number[];
    },
    c: Context,
  ) {
    c.log.debug({ symbol, state }, 'Saving price state to database');
    await Promise.all([
      db
        .insert(schema.kvStore)
        .values({ key: `${symbol}.price.lastZLEMA`, value: String(state.lastZLEMA) })
        .onConflictDoUpdate({
          target: schema.kvStore.key,
          set: { value: String(state.lastZLEMA) },
        }),
      db
        .insert(schema.kvStore)
        .values({ key: `${symbol}.price.breachCount`, value: String(state.breachCount) })
        .onConflictDoUpdate({
          target: schema.kvStore.key,
          set: { value: String(state.breachCount) },
        }),
      db
        .insert(schema.kvStore)
        .values({
          key: `${symbol}.price.rollingStd`,
          value: JSON.stringify(state.rollingStd),
        })
        .onConflictDoUpdate({
          target: schema.kvStore.key,
          set: { value: JSON.stringify(state.rollingStd) },
        }),
    ]);
    c.log.debug({ symbol }, 'Price state saved');
  }

  return {
    async detect(signal: SignalMetric, ctx: Context): Promise<void> {
      await ctx.with('Price spike detection', async (c) => {
        c.log.info('Price spike detection started');
        c.annotate('signal.id', signal.id);
        c.annotate('signal.type', signal.type);
        c.annotate('signal.createdAt', signal.createdAt);
        c.annotate('ticker.id', signal.tickerId);

        if (!validateSignal(signal, c)) {
          return;
        }

        const ticker = await db.query.tickers.findFirst({
          where: (t, { eq }) => eq(t.id, signal.tickerId),
        });

        if (!ticker) {
          c.log.error(signal, 'Ticker not found');
          return null;
        }

        const state = await getState(ticker.symbol, c);
        const { spikeDetected, difference, result } = processSignal(
          state,
          Number(signal.metric),
          c,
        );

        c.annotate('spikeDetected', spikeDetected);

        if (spikeDetected) {
          const story = makeStory({
            type: 'price',
            ticker: signal.tickerId,
            signal: signal.id,
            change: difference,
            createdAt: signal.createdAt,
          });
          const [{ id }] = await db.insert(schema.stories).values(story).returning();
          c.annotate('story.id', id);
          c.log.info('Price spike detected and story recorded');
        }

        await saveState(ticker.symbol, result, c);

        c.log.info('Price spike detection completed');
      });
    },
  };
}

import { type DBClient, type SignalMetric, makeStory, schema } from '@modules/db';
import type { Context } from '@modules/tracing';

const alpha = 0.005; // Smoothing factor for ZLEMA
const consecutiveBreachLimit = 5; // Number of consecutive breaches required
const minVolumeFloor = 100; // Minimum volume to consider for analysis
const rollingWindow = 10; // Number of periods to calculate dynamic thresholds

export interface MakeVolumeAnomalyDetectionService {
  db: DBClient;
}

export function makeVolumeAnomalyDetectionService({
  db,
}: MakeVolumeAnomalyDetectionService) {
  function validateSignal(signal: SignalMetric, c: Context): boolean {
    if (signal.type !== 'volume') {
      c.log.error('Invalid signal type');
      return false;
    }
    return true;
  }

  async function getState(symbol: string, c: Context) {
    c.log.debug({ symbol }, 'Fetching state from database');

    const [lastZLEMA, lastVolume, breachCount, rollingStd] = await Promise.all([
      db.query.kvStore.findFirst({
        where: (store, { eq }) => eq(store.key, `${symbol}.volume.lastZLEMA`),
      }),
      db.query.kvStore.findFirst({
        where: (store, { eq }) => eq(store.key, `${symbol}.volume.lastVolume`),
      }),
      db.query.kvStore.findFirst({
        where: (store, { eq }) => eq(store.key, `${symbol}.volume.breachCount`),
      }),
      db.query.kvStore.findFirst({
        where: (store, { eq }) => eq(store.key, `${symbol}.volume.rollingStd`),
      }),
    ]);

    const parsed = {
      lastZLEMA: lastZLEMA?.value ? Number(lastZLEMA.value) : null,
      lastVolume: lastVolume?.value ? Number(lastVolume.value) : null,
      breachCount: breachCount?.value ? Number(breachCount.value) : 0,
      rollingStd: rollingStd?.value ? JSON.parse(rollingStd.value) : [],
    };

    c.log.debug({ symbol, parsed }, 'Fetched state from database');
    return parsed;
  }

  function processSignal(
    state: {
      lastZLEMA: number | null;
      lastVolume: number | null;
      breachCount: number;
      rollingStd: number[];
    },
    currentVolume: number,
    c: Context,
  ): {
    spikeDetected: boolean;
    difference: number;
    result: {
      lastZLEMA: number;
      lastVolume: number;
      breachCount: number;
      rollingStd: number[];
    };
  } {
    let spikeDetected = false;
    let breachCount = state.breachCount;

    c.log.debug(
      { currentVolume, state },
      'Processing signal with dynamic thresholds and z-score',
    );

    // Handle nullable fields with defaults
    const prevZLEMA = state.lastZLEMA ?? currentVolume; // Use currentVolume as default if null
    const prevVolume = state.lastVolume ?? currentVolume; // Use currentVolume as default if null

    // Ignore volumes below the floor
    if (currentVolume < minVolumeFloor) {
      c.log.info(
        { currentVolume, minVolumeFloor },
        'Current volume is below the minimum volume floor. Ignoring signal.',
      );
      return {
        spikeDetected: false,
        difference: 0,
        result: {
          lastZLEMA: prevZLEMA,
          lastVolume: prevVolume,
          breachCount,
          rollingStd: state.rollingStd,
        },
      };
    }

    // ZLEMA Calculation
    const lag = 2 / (1 + alpha);
    const adjustedInput = currentVolume + (currentVolume - prevVolume) * lag;
    const lastZLEMA = alpha * adjustedInput + (1 - alpha) * prevZLEMA;

    c.log.debug({ adjustedInput, prevZLEMA, lastZLEMA }, 'Calculated new ZLEMA');

    // Calculate percentage difference and z-score
    const safeZLEMA = Math.max(lastZLEMA, 1);
    const percentageDifference = (Math.abs(currentVolume - lastZLEMA) / safeZLEMA) * 100;

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
      { percentageDifference, mean, stdDev, 'z-score': zScore },
      'Calculated dynamic threshold and z-score',
    );

    // Check thresholds
    if (percentageDifference > mean + stdDev && zScore > 2) {
      breachCount += 1;
      c.log.info({ percentageDifference, breachCount }, 'Threshold breached');
    } else {
      breachCount = 0;
    }

    // Detect sustained spike
    spikeDetected = breachCount >= consecutiveBreachLimit;
    if (spikeDetected) {
      c.log.info({ breachCount }, 'Sustained spike detected');
      breachCount = 0; // Reset breach count after detection
    }

    return {
      spikeDetected,
      difference: currentVolume - prevVolume,
      result: {
        lastZLEMA,
        lastVolume: currentVolume,
        breachCount,
        rollingStd: updatedRollingStd,
      },
    };
  }

  async function saveState(
    symbol: string,
    state: {
      lastZLEMA: number;
      lastVolume: number;
      breachCount: number;
      rollingStd: number[];
    },
    c: Context,
  ) {
    c.log.debug({ symbol, state }, 'Saving state to database');
    await Promise.all([
      db
        .insert(schema.kvStore)
        .values({ key: `${symbol}.volume.lastZLEMA`, value: String(state.lastZLEMA) })
        .onConflictDoUpdate({
          target: schema.kvStore.key,
          set: { value: String(state.lastZLEMA) },
        }),
      db
        .insert(schema.kvStore)
        .values({ key: `${symbol}.volume.lastVolume`, value: String(state.lastVolume) })
        .onConflictDoUpdate({
          target: schema.kvStore.key,
          set: { value: String(state.lastVolume) },
        }),
      db
        .insert(schema.kvStore)
        .values({ key: `${symbol}.volume.breachCount`, value: String(state.breachCount) })
        .onConflictDoUpdate({
          target: schema.kvStore.key,
          set: { value: String(state.breachCount) },
        }),
      db
        .insert(schema.kvStore)
        .values({
          key: `${symbol}.volume.rollingStd`,
          value: JSON.stringify(state.rollingStd),
        })
        .onConflictDoUpdate({
          target: schema.kvStore.key,
          set: { value: JSON.stringify(state.rollingStd) },
        }),
    ]);
    c.log.debug({ symbol }, 'State saved');
  }

  return {
    async detect(signal: SignalMetric, ctx: Context): Promise<void> {
      await ctx.with('Volume spike detection', async (c) => {
        c.log.info('Volume spike detection started');
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
            type: 'volume',
            ticker: signal.tickerId,
            signal: signal.id,
            change: difference,
            createdAt: signal.createdAt,
          });
          const [{ id }] = await db.insert(schema.stories).values(story).returning();
          c.annotate('story.id', id);
          c.log.info('Spike detected and story recorded');
        }

        await saveState(ticker.symbol, result, c);

        c.log.info('Volume spike detection completed');
      });
    },
  };
}

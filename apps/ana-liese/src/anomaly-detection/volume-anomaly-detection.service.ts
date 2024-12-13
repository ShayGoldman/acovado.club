import { schema, type DBClient, type SignalMetric, makeStory } from '@modules/db';
import type { Context } from '@modules/tracing';

// Suggested constants
const alpha = 0.005; // Smoothing factor for ZLEMA
const surgeThresholdPercentage = 25; // Detect spikes > 25%
const consecutiveBreachLimit = 5; // Number of consecutive breaches required

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

  async function getZLEMAState(tickerId: string, c: Context) {
    c.log.debug({ tickerId }, 'Fetching ZLEMA state from database');
    const stateRow = await db.query.kvStore.findFirst({
      where: (store, { eq }) => eq(store.key, tickerId),
    });

    if (!stateRow) {
      c.log.info({ tickerId }, 'No existing ZLEMA state found, initializing new state');
      return null;
    }

    const [lastZLEMA, lastVolume, breachCount] = stateRow.value.split(',').map(Number);
    c.log.debug(
      { tickerId, lastZLEMA, lastVolume, breachCount },
      'Fetched ZLEMA state from database',
    );
    return { lastZLEMA, lastVolume, breachCount };
  }

  function processSignal(
    state: {
      lastZLEMA: number;
      lastVolume: number;
      breachCount: number;
    } | null,
    currentVolume: number,
    c: Context,
  ): {
    surgeDetected: boolean;
    difference: number;
    result: { lastZLEMA: number; lastVolume: number; breachCount: number };
  } {
    let lastZLEMA = 0,
      lastVolume = 0,
      breachCount = 0;
    let surgeDetected = false;

    c.log.debug(
      { currentVolume, state },
      'Processing current signal with existing state',
    );

    if (state) {
      const {
        lastZLEMA: prevZLEMA,
        lastVolume: prevVolume,
        breachCount: prevBreachCount,
      } = state;

      // ZLEMA calculation: Adjust the input
      const lag = 2 / alpha; // ZLEMA lag is based on alpha
      const adjustedInput = currentVolume + (currentVolume - (prevVolume || 0) * lag);

      // Compute ZLEMA
      lastZLEMA = alpha * adjustedInput + (1 - alpha) * prevZLEMA;

      // Log ZLEMA calculation
      c.log.debug({ adjustedInput, prevZLEMA, lastZLEMA }, 'Calculated new ZLEMA');

      // Calculate percentage difference
      const safeZLEMA = Math.max(lastZLEMA, 1);
      const percentageDifference =
        (Math.abs(currentVolume - lastZLEMA) / safeZLEMA) * 100;

      c.log.info(
        { currentVolume, lastZLEMA, percentageDifference },
        'Computed percentage difference for anomaly detection',
      );

      // Check threshold breach
      if (percentageDifference > surgeThresholdPercentage) {
        breachCount = prevBreachCount + 1;
        c.log.info({ percentageDifference, breachCount }, 'Threshold breached');
      } else {
        breachCount = 0;
      }

      // Detect sustained surge
      surgeDetected = breachCount >= consecutiveBreachLimit;

      if (surgeDetected) {
        c.log.info({ breachCount }, 'Sustained surge detected');
        breachCount = 0; // Reset counter after detection
      }

      lastVolume = currentVolume;
    } else {
      // Initialize state
      lastZLEMA = currentVolume;
      lastVolume = currentVolume;
      breachCount = 0;
      c.log.info('Initialized ZLEMA state');
    }

    c.log.debug(
      { surgeDetected, breachCount, lastZLEMA, lastVolume },
      'Processed signal result',
    );

    return {
      surgeDetected,
      difference: currentVolume - (state?.lastVolume || 0),
      result: { lastZLEMA, lastVolume, breachCount },
    };
  }

  async function saveZLEMAState(
    tickerId: string,
    state: { lastZLEMA: number; lastVolume: number; breachCount: number },
    c: Context,
  ) {
    const value = `${state.lastZLEMA},${state.lastVolume},${state.breachCount}`;
    c.log.debug({ tickerId, value }, 'Saving ZLEMA state to database');
    await db.insert(schema.kvStore).values({ key: tickerId, value }).onConflictDoUpdate({
      target: schema.kvStore.key,
      set: { value },
    });
    c.log.debug({ tickerId }, 'ZLEMA state saved');
  }

  return {
    async detect(signal: SignalMetric, ctx: Context): Promise<void> {
      await ctx.with('Volume spike detection', async (c) => {
        c.log.info('Volume spike detection started');

        if (!validateSignal(signal, c)) {
          return;
        }

        const state = await getZLEMAState(signal.tickerId, c);
        const { surgeDetected, difference, result } = processSignal(
          state,
          Number(signal.metric),
          c,
        );

        if (state && surgeDetected) {
          const story = makeStory({
            ticker: signal.tickerId,
            volumeChange: difference,
          });
          await db.insert(schema.stories).values(story);
          c.log.info('Surge detected and story recorded');
        }

        await saveZLEMAState(signal.tickerId, result, c);

        c.log.info('Volume spike detection completed');
      });
    },
  };
}

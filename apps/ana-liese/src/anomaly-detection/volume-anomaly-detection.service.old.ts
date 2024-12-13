import { schema, type DBClient, type SignalMetric, makeStory } from '@modules/db';
import type { Context } from '@modules/tracing';

// Suggested constants
const alpha = 0.005; // Smoothing factor for level
const beta = 0.0005; // Smoothing factor for trend
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

  async function getHoltState(tickerId: string, c: Context) {
    const stateRow = await db.query.kvStore.findFirst({
      where: (store, { eq }) => eq(store.key, tickerId),
    });

    if (!stateRow) return null;

    const [level, trend, lastVolume, breachCount] = stateRow.value.split(',').map(Number);
    return { level, trend, lastVolume, breachCount };
  }

  function processSignal(
    state: {
      level: number;
      trend: number;
      lastVolume: number;
      breachCount: number;
    } | null,
    currentVolume: number,
    c: Context,
  ): {
    surgeDetected: boolean;
    difference: number;
    result: { level: number; trend: number; lastVolume: number; breachCount: number };
  } {
    let L = 0,
      T = 0,
      lastVolume = 0,
      breachCount = 0;
    let surgeDetected = false;

    if (state) {
      const delta = currentVolume - state.lastVolume;
      if (delta < 0) {
        c.log.error(
          { delta, lastVolume: state.lastVolume, currentVolume },
          'Negative delta, skipping signal',
        );
        return {
          surgeDetected: false,
          difference: 0,
          result: {
            level: state.level,
            trend: state.trend,
            lastVolume: state.lastVolume,
            breachCount: state.breachCount,
          },
        };
      }

      const prevL = state.level;

      // Update level and trend
      L = alpha * currentVolume + (1 - alpha) * (state.level + state.trend);
      T = beta * (L - prevL) + (1 - beta) * state.trend;

      // Calculate forecast and percentage difference
      const forecast = L + T;
      const safeForecast = Math.max(forecast, 1);
      const percentageDifference =
        (Math.abs(currentVolume - forecast) / safeForecast) * 100;

      // Check if the threshold is breached
      if (percentageDifference > surgeThresholdPercentage) {
        breachCount = state.breachCount + 1;
        c.log.info(
          { delta, forecast, percentageDifference, breachCount },
          'Threshold breached',
        );
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
      L = currentVolume;
      T = 0;
      lastVolume = currentVolume;
      breachCount = 0;
      c.log.info('Initialized Holt state');
    }

    return {
      surgeDetected,
      difference: currentVolume - (state?.lastVolume || 0),
      result: { level: L, trend: T, lastVolume, breachCount },
    };
  }

  async function saveHoltState(
    tickerId: string,
    state: { level: number; trend: number; lastVolume: number; breachCount: number },
    c: Context,
  ) {
    const value = `${state.level},${state.trend},${state.lastVolume},${state.breachCount}`;
    await db.insert(schema.kvStore).values({ key: tickerId, value }).onConflictDoUpdate({
      target: schema.kvStore.key,
      set: { value },
    });

    c.log.debug({ tickerId }, 'Holt state saved');
  }

  return {
    async detect(signal: SignalMetric, ctx: Context): Promise<void> {
      await ctx.with('Volume spike detection', async (c) => {
        c.log.info('Volume spike detection started');

        if (!validateSignal(signal, c)) {
          return;
        }

        const state = await getHoltState(signal.tickerId, c);
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

        await saveHoltState(signal.tickerId, result, c);

        c.log.info('Volume spike detection completed');
      });
    },
  };
}

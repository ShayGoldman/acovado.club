import { makeVolumeAnomalyDetectionService } from '@/anomaly-detection/volume-anomaly-detection.service';
import { type DBClient, type SignalMetric } from '@modules/db';
import type { BasePayload, Message } from '@modules/events';
import type { Context } from '@modules/tracing';

export interface MakeOnSignalCreatedServiceOpts {
  db: DBClient;
}

export function makeOnSignalCreatedService({ db }: MakeOnSignalCreatedServiceOpts) {
  const volumeAnomalyDetectionService = makeVolumeAnomalyDetectionService({ db });

  return {
    async onSignalCreated(
      message: Message<BasePayload<SignalMetric, 'signal', 'signal.created'>>,
      c: Context,
    ) {
      const { data } = message.payload;

      c.annotate('signal.id', data.id);
      c.annotate('signal.type', data.type);

      c.log.debug(message, 'Received signal.created message');
      c.log.info('Processing signal.created message');

      if (data.type === 'volume') {
        await volumeAnomalyDetectionService.detect(data, c);
      }

      c.log.info('signal.created message processed');
    },
  };
}

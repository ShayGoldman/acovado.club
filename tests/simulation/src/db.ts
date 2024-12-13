import { makeDBClient } from '@modules/db';
import type { Logger } from '@modules/logger';

export interface MakeDBOpts {
  url: string;
  logger: Logger;
}

export function makeDB({ url, logger }: MakeDBOpts) {
  return makeDBClient({
    url,
    logger,
  });
}

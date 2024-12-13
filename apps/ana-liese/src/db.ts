import { makeDBClient } from '@modules/db';
import type { Logger } from '@modules/logger';

export interface MakeDBOpts {
  url: string;
  logger: Logger;
}

export function makeDB(opts: MakeDBOpts) {
  return makeDBClient({
    url: opts.url,
    logger: opts.logger,
  });
}

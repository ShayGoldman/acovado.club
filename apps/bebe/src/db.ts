import { makeDBClient } from '@modules/db';

export interface MakeDBOpts {
  url: string;
}

export function makeDB(opts: MakeDBOpts) {
  return makeDBClient({
    url: opts.url,
    logger: true,
  });
}

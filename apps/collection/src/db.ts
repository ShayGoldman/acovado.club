import { makeDBClient } from '@modules/db';

export function makeDB() {
  return makeDBClient({
    url: 'postgres://postgres:postgres@localhost:5432/postgres',
    logger: true,
  });
}

import type { Logger } from '@modules/logger';
import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import { makeDBClient } from './client';

export interface MakeMigrateDBOpts {
  url: string;
  logger: Logger;
}

export function makeMigrateDB({ url, logger }: MakeMigrateDBOpts) {
  const db = makeDBClient({ url, logger });

  return async () => {
    const migrationsFolder = path.resolve(__dirname, './migrations');
    logger.info(`Running migrations from folder: ${migrationsFolder}`);
    await runMigrations(db, {
      migrationsFolder,
      migrationsSchema: 'migrations',
      migrationsTable: '__migrations__',
    });
    logger.info('Migrations applied successfully.');
  };
}

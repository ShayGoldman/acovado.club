import type { Logger } from '@modules/logger';
import crypto from 'crypto';
import path from 'path';
import { readdir } from 'node:fs/promises';
import { Promise } from 'bluebird';
import { sql } from 'drizzle-orm';

import { makeDBClient, type DBClient } from '@/client';

export interface MigrationOpts {
  migrationsSchema?: string;
  migrationsTable?: string;
  concurrentHashes?: number;
}

export interface MakeMigrateDBOpts {
  url: string;
  logger: Logger;
  opts?: MigrationOpts;
}

async function ensureMigrationsTable(db: DBClient, schema: string, table: string) {
  // Create schema if it doesn't exist
  const createSchemaQuery = `
    CREATE SCHEMA IF NOT EXISTS ${schema};
  `;

  // Create the migrations table in the specified schema
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS ${schema}.${table} (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await db.execute(createSchemaQuery);
  await db.execute(createTableQuery);
}

async function getAppliedMigrations(
  db: DBClient,
  schema: string,
  table: string,
): Promise<Map<string, string>> {
  const query = `SELECT filename, checksum FROM ${schema}.${table}`;
  const result = await db.execute<{ filename: string; checksum: string }>(query);

  const applied = new Map<string, string>();
  for (const row of result.rows) {
    applied.set(row.filename, row.checksum);
  }

  return applied;
}

async function getSqlFiles(
  folder: string,
  concurrentHashes: number,
): Promise<{ filename: string; checksum: string }[]> {
  const entries = await readdir(folder);

  const sqlFiles = entries.filter((entry) => entry.endsWith('.sql'));

  const result = await Promise.map(
    sqlFiles,
    async (file) => {
      const filePath = path.join(folder, file);
      const content = await Bun.file(filePath).text();
      const checksum = crypto.createHash('md5').update(content).digest('hex');
      return { filename: file, checksum };
    },
    { concurrency: concurrentHashes },
  );

  return result.sort((a, b) => a.filename.localeCompare(b.filename));
}

async function runSingleMigration(
  db: DBClient,
  file: string,
  checksum: string,
  folder: string,
  schema: string,
  table: string,
  logger: Logger,
) {
  const migrationPath = path.join(folder, file);
  const tsPath = migrationPath.replace('.sql', '.ts');

  logger.info(`Starting migration: ${file}`);

  const sqlStatements = await Bun.file(migrationPath).text();

  // Attempt to load pre/post hooks
  logger.debug(`Checking for hooks in: ${tsPath}`);
  const hooks = (await Bun.file(tsPath).exists()) ? await import(tsPath) : {};
  logger.debug(
    hooks.pre || hooks.post ? `Hooks found for ${file}` : `No hooks found for ${file}`,
  );

  // Start transaction
  await db.transaction(async (tx) => {
    try {
      // Run pre hook
      if (hooks.pre) {
        logger.info(`Running pre-hook for: ${file}`);
        await hooks.pre(tx);
        logger.info(`Pre-hook executed successfully for: ${file}`);
      }

      // Execute SQL
      logger.info(`Executing SQL migration: ${file}`);
      await tx.execute(sqlStatements);
      logger.info(`SQL executed successfully for: ${file}`);

      // Run post hook
      if (hooks.post) {
        logger.info(`Running post-hook for: ${file}`);
        await hooks.post(tx);
        logger.info(`Post-hook executed successfully for: ${file}`);
      }

      // Log migration as applied
      const insertQuery = sql.raw(`
        INSERT INTO "${schema}"."${table}" (filename, checksum)
        VALUES ('${file}', '${checksum}');
        `);

      logger.info(`Logging migration as applied: ${file}`);
      await tx.execute(insertQuery);
      logger.info(`Migration logged successfully for: ${file}`);
    } catch (error) {
      logger.error({ error }, `Migration failed for: ${file}. Rolling back.`);
      await tx.rollback();
      logger.error(`Transaction rolled back for: ${file}`);
      throw error;
    }
  });

  logger.info(`Migration completed successfully: ${file}`);
}

export function makeMigrateDB({ url, logger, opts }: MakeMigrateDBOpts) {
  const db = makeDBClient({ url, logger });

  return async () => {
    const migrationsSchema = opts?.migrationsSchema ?? 'migrations';
    const migrationsTable = opts?.migrationsTable ?? '__migrations__';
    const concurrentHashes = opts?.concurrentHashes ?? 10;

    const migrationsFolder = path.resolve(__dirname, './migrations');
    logger.info('Migrating Database...');

    logger.debug(
      { migrationsSchema, migrationsTable, migrationsFolder, concurrentHashes },
      'Using these options for migration',
    );

    // 1. Ensure migrations table
    logger.debug('Ensuring migrations table exists...');
    await ensureMigrationsTable(db, migrationsSchema, migrationsTable);
    logger.debug('Migrations table verified.');

    // 2. Get applied migrations
    logger.debug('Fetching applied migrations...');
    const applied = await getAppliedMigrations(db, migrationsSchema, migrationsTable);
    logger.debug(
      `Applied migrations: ${Array.from(applied.keys()).join(', ') || 'None'}`,
    );

    // 3. Get all SQL files with their checksums
    logger.debug('Retrieving all SQL migration files...');
    const migrationFiles = await getSqlFiles(migrationsFolder, concurrentHashes);
    logger.debug(
      `Found migration files: ${migrationFiles.map((f) => f.filename).join(', ')}`,
    );

    // 4. Detect out-of-order migrations
    logger.debug('Checking for out-of-order migrations...');
    const appliedFilenames = Array.from(applied.keys());
    const driftedMigration = migrationFiles.filter(
      ({ filename }) =>
        !applied.has(filename) &&
        appliedFilenames.some((appliedFile) => filename < appliedFile),
    );

    if (driftedMigration.length > 0) {
      throw new Error(
        `Migration drift detected in: ${driftedMigration.map((f) => f.filename).join(', ')}`,
      );
    }

    // 5. Filter out already-applied migrations
    logger.debug('Filtering out already-applied migrations...');
    const pending = migrationFiles.filter(
      ({ filename, checksum }) =>
        !applied.has(filename) || applied.get(filename) !== checksum,
    );
    logger.debug(
      `Pending migrations: ${pending.map((f) => f.filename).join(', ') || 'None'}`,
    );

    // 6. Run pending migrations in order
    for (const { filename, checksum } of pending) {
      logger.info(`Running migration: ${filename}`);
      logger.debug(`Checksum for migration ${filename}: ${checksum}`);
      await runSingleMigration(
        db,
        filename,
        checksum,
        migrationsFolder,
        migrationsSchema,
        migrationsTable,
        logger,
      );
      logger.info(`Successfully applied migration: ${filename}`);
    }

    logger.info('All migrations applied successfully.');
  };
}

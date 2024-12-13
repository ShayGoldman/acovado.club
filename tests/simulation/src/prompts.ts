import { and, eq, gte, lte, schema } from '@modules/db';
import { makeLogger } from '@modules/logger';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { Config } from './config';
import { makeDB } from './db';
import { type CompleteInputs, CompleteInputSchema, type PartialInputs } from './schemas';

export async function promptForMissingInputs(
  inputs: PartialInputs,
  config: Config,
): Promise<CompleteInputs> {
  const db = makeDB({
    url: config.DATABASE_URL,
    logger: makeLogger({ name: 'simulation' }),
  });

  // Validate input and prompt until valid
  async function validateAndPrompt<T>(
    promptFn: () => Promise<T>,
    schema: any,
    fieldName: string,
  ): Promise<T> {
    while (true) {
      try {
        const value = await promptFn();
        return schema.parse(value);
      } catch (error: any) {
        console.log(
          chalk.redBright(`Invalid ${fieldName}: `) +
            chalk.yellow(error.errors?.[0]?.message || 'Please try again.'),
        );
      }
    }
  }

  // Prompt for timeframe
  async function promptForTimeframe(): Promise<{ start: string; end: string }> {
    const { option } = await inquirer.prompt([
      {
        type: 'list',
        name: 'option',
        message: 'Select timeframe:',
        choices: [
          { name: 'Single Day (YYYY-MM-DD)', value: 'day' },
          { name: 'Start and End Date (ISO 8601)', value: 'range' },
        ],
      },
    ]);

    if (option === 'day') {
      const day = await validateAndPrompt(
        async () =>
          (
            await inquirer.prompt([
              { type: 'input', name: 'day', message: 'Enter the day (YYYY-MM-DD):' },
            ])
          ).day,
        CompleteInputSchema.shape.start, // Schema validation for dates
        'day',
      );

      return { start: `${day}T00:00:00.000Z`, end: `${day}T23:59:59.999Z` };
    }

    const start = await validateAndPrompt(
      async () =>
        (
          await inquirer.prompt([
            { type: 'input', name: 'start', message: 'Enter start date (ISO 8601):' },
          ])
        ).start,
      CompleteInputSchema.shape.start,
      'start',
    );

    const end = await validateAndPrompt(
      async () =>
        (
          await inquirer.prompt([
            { type: 'input', name: 'end', message: 'Enter end date (ISO 8601):' },
          ])
        ).end,
      CompleteInputSchema.shape.end,
      'end',
    );

    return { start, end };
  }

  // Prompt for tickers
  async function promptForTickers(start: string, end: string): Promise<string[]> {
    const availableSymbols = await db
      .selectDistinct({ symbol: schema.tickers.symbol })
      .from(schema.signalMetrics)
      .innerJoin(schema.tickers, eq(schema.signalMetrics.tickerId, schema.tickers.id))
      .where(
        and(
          gte(schema.signalMetrics.createdAt, new Date(start)),
          lte(schema.signalMetrics.createdAt, new Date(end)),
        ),
      )
      .orderBy(schema.tickers.symbol);

    if (availableSymbols.length === 0) {
      console.error(chalk.red('No tickers available for the selected timeframe.'));
      process.exit(1);
    }

    return await validateAndPrompt(
      async () =>
        (
          await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'tickers',
              message: 'Select tickers:',
              choices: availableSymbols.map((ticker) => ({
                name: ticker.symbol,
                value: ticker.symbol,
              })),
            },
          ])
        ).tickers,
      CompleteInputSchema.shape.tickers,
      'tickers',
    );
  }

  // Prompt for signal type
  async function promptForSignalType(): Promise<string> {
    const availableTypes = await db
      .selectDistinct({ type: schema.signalMetrics.type })
      .from(schema.signalMetrics)
      .orderBy(schema.signalMetrics.type);

    if (availableTypes.length === 0) {
      console.error(chalk.red('No signal types available.'));
      process.exit(1);
    }

    return await validateAndPrompt(
      async () =>
        (
          await inquirer.prompt([
            {
              type: 'list',
              name: 'type',
              message: 'Select signal type:',
              choices: availableTypes.map((signalType) => ({
                name: signalType.type,
                value: signalType.type,
              })),
            },
          ])
        ).type,
      CompleteInputSchema.shape.type,
      'type',
    );
  }

  // Prompt for delay
  async function promptForDelay(): Promise<number> {
    return await validateAndPrompt(
      async () =>
        parseInt(
          (
            await inquirer.prompt([
              {
                type: 'input',
                name: 'delay',
                message: 'Enter delay between events (ms):',
                default: '0',
                validate: (input) =>
                  !isNaN(parseInt(input, 10)) || 'Please enter a valid number.',
              },
            ])
          ).delay,
          10,
        ),
      CompleteInputSchema.shape.delay,
      'delay',
    );
  }

  // Determine start and end based on inputs or prompt interactively
  async function determineTimeframe(
    inputs: PartialInputs,
  ): Promise<Pick<CompleteInputs, 'start' | 'end'>> {
    if (inputs.day) {
      return {
        start: `${inputs.day}T00:00:00.000Z`,
        end: `${inputs.day}T23:59:59.999Z`,
      };
    }

    if (inputs.start && inputs.end) {
      return {
        start: inputs.start,
        end: inputs.end,
      };
    }

    return await promptForTimeframe();
  }

  // Collect missing inputs reactively
  const { start, end } = await determineTimeframe(inputs);

  const tickers =
    inputs.tickers && inputs.tickers.length > 0
      ? inputs.tickers
      : await promptForTickers(start, end);

  const type = inputs.type || (await promptForSignalType());
  const delay = inputs.delay !== undefined ? inputs.delay : await promptForDelay();

  // Validate and return the complete inputs
  return CompleteInputSchema.parse({
    tickers,
    start,
    end,
    type,
    delay,
  });
}

import { Command } from 'commander';
import { loadConfig } from './config';
import { validateInputs } from './validation';
import { promptForMissingInputs } from './prompts';
import { runSimulation } from './simulation';

const program = new Command();

program
  .name('simulate')
  .description('Simulates stock market signal events.')
  .option('--start <datetime>', 'Start date/time (ISO 8601).')
  .option('--end <datetime>', 'End date/time (ISO 8601).')
  .option('--day <date>', 'Single day (YYYY-MM-DD).')
  .option('--tickers <symbols>', 'Comma-separated ticker symbols.')
  .option('--type <type>', 'Signal type')
  .option('--delay <ms>', 'Delay between events.')
  .action(async (options) => {
    // Load and validate configuration
    const config = loadConfig();

    // Validate initial inputs
    const validatedInputs = validateInputs(options);

    // Prompt for missing inputs and validate again
    const completeInputs = await promptForMissingInputs(validatedInputs, config);

    // Run the simulation
    await runSimulation(completeInputs, config);

    // TODO add a runtime object with setup and teardown
    process.exit(0);
  });

program.parse(process.argv);

#!/usr/bin/env bun

import inquirer from 'inquirer';

// Base directories for apps and infra
const BASE_DIR = process.cwd();
const APPS_DIR = `${BASE_DIR}/apps`;
const INFRA_DIR = `${BASE_DIR}/infra`;

// Helper to find all docker-compose.yml files
function findComposeFiles(dir: string) {
  // Use Bun's filesystem API to list folders and check for docker-compose.yml
  return Bun.file(dir)

    .childrenSync()
    .filter((child) => child.type === 'directory')
    .map((folder) => folder.path)
    .filter((folderPath) => Bun.file(`${folderPath}/docker-compose.yml`).existsSync())
    .map((folderPath) => ({
      name: folderPath.split('/').pop()!, // Get the folder name
      value: `${folderPath}/docker-compose.yml`,
    }));
}

// Main CLI function
async function runCLI() {
  // Collect services from apps and infra
  const appServices = findComposeFiles(APPS_DIR);
  const infraServices = findComposeFiles(INFRA_DIR);

  // Combine into a single list for selection
  const allServices = [
    ...infraServices.map((service) => ({
      name: `infra/${service.name}`,
      value: service.value,
    })),
    ...appServices.map((service) => ({
      name: `apps/${service.name}`,
      value: service.value,
    })),
  ];

  // Prompt the user to select services
  const { selectedServices } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedServices',
      message: 'Select services to run:',
      choices: allServices,
    },
  ]);

  if (selectedServices.length === 0) {
    console.log('No services selected. Exiting...');
    return;
  }

  // Build the docker compose command
  const composeCommand = [
    'docker compose',
    ...selectedServices.map((file) => `-f ${file}`),
    'up',
  ].join(' ');

  console.log(`Running: ${composeCommand}`);

  // Run the command using Bun.spawn
  const process = Bun.spawn(composeCommand, {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
    shell: true,
  });

  const exitCode = await process.exited;
  console.log(`Command exited with code ${exitCode}`);
}

runCLI().catch((error) => {
  console.error('Error:', error.message);
});

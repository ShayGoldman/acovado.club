/** @type {import("jest").Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**.test.ts'],
  maxConcurrency: 4,
  maxWorkers: 4,
  // TODO depends on opting in for swc
  // transform: {
  //   '**/*.ts$': '@swc/jest'
  // }
};

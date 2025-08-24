import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  // ESM + TS via ts-jest
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/tsconfig.json' }]
  },
  extensionsToTreatAsEsm: ['.ts'],
  verbose: true,
  collectCoverage: true,
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageReporters: ['text', 'lcov'],
  // Stable CI runs
  testTimeout: 30000
};

export default config;
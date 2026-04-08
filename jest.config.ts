import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // Only pick up files inside src/__tests__
  testMatch: ['<rootDir>/src/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    // Mirror the tsconfig path aliases so imports resolve correctly inside tests
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // Relax a few compiler options that ts-jest struggles with under the
          // Next.js "bundler" moduleResolution strategy.
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowJs: true,
        },
      },
    ],
  },
  // Show verbose output so every test case is listed in CI logs
  verbose: true,
  // Global setup / teardown hooks (none required for unit tests)
  clearMocks: true,
  restoreMocks: true,
};

export default config;

/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jest-environment-node',
  rootDir: '.',
  // Only pick up files inside src/__tests__
  testMatch: ['<rootDir>/src/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    // Mirror the tsconfig path aliases so imports resolve correctly in tests
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // Relax compiler options that ts-jest struggles with under the
          // Next.js "bundler" moduleResolution strategy.
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowJs: true,
        },
      },
    ],
  },
  // Show verbose output so every test case is listed
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
};

module.exports = config;

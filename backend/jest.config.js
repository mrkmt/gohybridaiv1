/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Pick up tests from both api/ (existing) and src/ (new service tests)
  testMatch: [
    '<rootDir>/api/**/*.test.ts',
    '<rootDir>/src/**/__tests__/**/*.test.ts',
    '<rootDir>/src/**/*.test.ts',
  ],
  // Skip heavy Playwright-generated spec files and playwright config
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test-results/',
    '/tests/generated/',
    '/tests/playwright/',
    '/tests/_archive_tickets/',
    '/tests/gen/',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      diagnostics: false, // --transpile-only equivalent: skip type errors in tests
    }],
  },
  // Module name mapping for path aliases (none currently but kept for future)
  moduleNameMapper: {},
  // Coverage from both api/ and src/services/ (exclude generated/e2e)
  collectCoverageFrom: [
    'api/**/*.ts',
    'src/services/**/*.ts',
    '!src/services/**/__tests__/**',
    '!api/server.ts',
    '!**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  // Clear mocks between tests automatically
  clearMocks: true,
  restoreMocks: false,
};

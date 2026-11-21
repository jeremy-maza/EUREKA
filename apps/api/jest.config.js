/** @type {import('jest').Config} */
const base = {
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  // El cliente Prisma generado importa con extensión .js (nodenext); Jest debe resolver el .ts.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
};

module.exports = {
  projects: [
    {
      ...base,
      displayName: 'unit',
      roots: ['<rootDir>/src', '<rootDir>/test'],
      testRegex: '(src|test)/(?!integration/).*\\.spec\\.ts$',
      setupFiles: ['<rootDir>/test/setup/env.ts'],
    },
    {
      // Pruebas de integración contra PostgreSQL real (PGlite en proceso + migraciones SQL del repositorio).
      // Se ejecutan en serie (un único PGlite compartido): `npm run test:integration`.
      ...base,
      displayName: 'integration',
      roots: ['<rootDir>/test/integration'],
      testRegex: '\\.int-spec\\.ts$',
      globalSetup: '<rootDir>/test/setup/pglite-global-setup.ts',
      globalTeardown: '<rootDir>/test/setup/pglite-global-teardown.ts',
      setupFiles: ['<rootDir>/test/setup/env.ts', '<rootDir>/test/setup/integration-env.ts'],
      testTimeout: 30000,
    },
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/generated/**', '!src/main.ts', '!src/**/*.spec.ts'],
  coverageDirectory: 'coverage',
};

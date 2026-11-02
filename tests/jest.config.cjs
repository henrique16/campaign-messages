/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Inline compiler options: o tsconfig.json do projeto tem rootDir "src" e types ["node"],
        // o que não cobre os testes nem os globais do Jest.
        tsconfig: {
          target: 'ES2022',
          module: 'commonjs',
          lib: ['ES2022'],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          types: ['node', 'jest'],
        },
      },
    ],
  },
}

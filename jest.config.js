// Config em .js e não .ts de propósito: `jest.config.ts` exige `ts-node`
// instalado só para o Jest conseguir LER a própria configuração, e isso é uma
// árvore de dependências inteira para resolver um arquivo de vinte linhas.
// Continua sendo arquivo próprio, que é o que a regra R12 pede — o que ela
// recusa é a configuração enterrada no package.json.

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // `rootDir: src` com `testRegex` de `.spec.ts` APLICA a convenção R4 sem
  // ninguém precisar policiar: spec fora de `src/` não roda na suíte unitária.
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!**/*.interface.ts'],
  coverageDirectory: '../coverage',
  // Um limite GLOBAL, e não os 12 blocos por pasta do repositório-base — lá
  // aquilo é mapa de dívida de um repositório que nasceu sem cobertura.
  coverageThreshold: {
    global: { statements: 80, branches: 70, functions: 80, lines: 80 },
  },
  clearMocks: true,
};

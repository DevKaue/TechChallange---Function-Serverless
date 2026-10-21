// Suíte de INTEGRAÇÃO, separada da unitária de propósito.
//
// A unitária tem `rootDir: src` e threshold de cobertura global; misturar aqui
// faria o `npm test` local exigir um Postgres de pé, e a cobertura da integração
// inflaria o número da unitária sem provar regra nenhuma a mais. Por isso a
// integração não coleta cobertura: ela prova COMPORTAMENTO contra o banco real.

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/integration'],
  testRegex: '.*\\.int-spec\\.ts$',
  // Um teste segura LOCK de tabela para provocar statement timeout; 30 s dá
  // folga para o service container frio do CI sem esconder travamento real.
  testTimeout: 30_000,
  clearMocks: true,
};

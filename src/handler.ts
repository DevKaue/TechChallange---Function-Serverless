import { readFileSync } from 'node:fs';
import { Pool, type PoolConfig } from 'pg';
import { composeAuthHandler } from './infra/composition/auth-composition';
import { SsmSecretProvider } from './infra/config/ssm-secret.provider';
import { authBootstrapFailure, createLazyHandler } from './infra/http/lazy-handler';
import { ConsoleJsonLogger } from './infra/logging/logger';
import type { SqlClient } from './infra/repositories/pg-customer.repository';

// Composition root da função de autenticação (POST /auth). Sem regra aqui: só
// instâncias concretas. O que tem decisão está em infra/composition e é testado.
//
// Escopo de módulo = um por container. O SsmSecretProvider cacheia por path e o
// Pool abre no máximo uma conexão, reaproveitada entre invocações aquecidas.

const logger = new ConsoleJsonLogger();
const secrets = new SsmSecretProvider();

function createSqlClient(config: PoolConfig): SqlClient {
  const pool = new Pool(config);

  // Sem listener, erro num cliente OCIOSO (RDS reiniciado, failover, conexão
  // cortada pelo NAT) derruba o processo inteiro com unhandled 'error'.
  pool.on('error', (error: Error) => {
    logger.write('error', {
      event: 'db.pool_error',
      correlationId: 'pool',
      requestId: 'pool',
      outcome: 'error',
      durationMs: 0,
      coldStart: false,
      reason: 'idle_client_error',
      errorCode: error.name,
    });
  });

  return {
    async query<T>(text: string, values: readonly unknown[]): Promise<{ rows: T[] }> {
      const result = await pool.query(text, [...values]);
      return { rows: result.rows as T[] };
    },
  };
}

export const handler = createLazyHandler(
  () =>
    composeAuthHandler({
      env: process.env,
      secrets,
      logger,
      readCaBundle: (path) => readFileSync(path, 'utf8'),
      createSqlClient,
    }),
  authBootstrapFailure(logger),
);

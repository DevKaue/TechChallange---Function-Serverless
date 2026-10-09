import type { PoolConfig } from 'pg';
import { AuthenticateCustomerUseCase } from '../../application/usecases/authenticate-customer.usecase';
import type { SecretProvider } from '../../domain/contracts/secret-provider.interface';
import { loadAuthorizerConfig, loadRuntimeConfig } from '../config/runtime-config';
import {
  DEFAULT_RDS_CA_BUNDLE_PATH,
  buildPoolConfig,
  loadDatabaseSettings,
} from '../database/database-settings';
import { createAuthorizerHandler } from '../http/authorizer-http.handler';
import { createAuthHttpHandler } from '../http/auth-http.handler';
import type { Logger } from '../logging/logger';
import { PgCustomerRepository, type SqlClient } from '../repositories/pg-customer.repository';
import { JsonWebTokenService } from '../security/jsonwebtoken-token.service';
import { JsonWebTokenVerifier } from '../security/jsonwebtoken-token.verifier';
import { RandomUuidGenerator } from '../security/random-uuid.generator';

/**
 * Tudo que tem efeito colateral entra por aqui: variáveis de ambiente, SSM,
 * sistema de arquivos e criação do Pool. Com isso a montagem inteira é testável
 * com fakes, e `src/handler.ts` fica com meia dúzia de linhas sem regra.
 */
export interface AuthCompositionPorts {
  env: NodeJS.ProcessEnv;
  secrets: SecretProvider;
  logger: Logger;
  readCaBundle: (path: string) => string;
  createSqlClient: (config: PoolConfig) => SqlClient;
}

export async function composeAuthHandler(ports: AuthCompositionPorts) {
  // Config primeiro e síncrona: variável ausente falha antes de qualquer
  // chamada ao SSM, com a mensagem que diz qual variável falta.
  const config = loadRuntimeConfig(ports.env);

  const [jwtSecret, database] = await Promise.all([
    ports.secrets.get(config.jwtSecretSsmPath),
    loadDatabaseSettings(ports.secrets, config.dbSsmPrefix),
  ]);

  // O assinador valida o tamanho do segredo no construtor: segredo curto
  // derruba o bootstrap (503 no contrato), e a função nunca emite token forjável.
  const tokenService = new JsonWebTokenService(jwtSecret);

  const caPath = ports.env.RDS_CA_BUNDLE_PATH?.trim() || DEFAULT_RDS_CA_BUNDLE_PATH;
  const sql = ports.createSqlClient(buildPoolConfig(database, ports.readCaBundle(caPath)));

  const useCase = new AuthenticateCustomerUseCase(
    new PgCustomerRepository(sql),
    tokenService,
    new RandomUuidGenerator(),
  );

  return createAuthHttpHandler(useCase, ports.logger);
}

export interface AuthorizerCompositionPorts {
  env: NodeJS.ProcessEnv;
  secrets: SecretProvider;
  logger: Logger;
}

export async function composeAuthorizerHandler(ports: AuthorizerCompositionPorts) {
  const config = loadAuthorizerConfig(ports.env);
  const secret = await ports.secrets.get(config.jwtSecretSsmPath);
  return createAuthorizerHandler(new JsonWebTokenVerifier(secret), ports.logger);
}

import type { PoolConfig } from 'pg';
import type { SecretProvider } from '../../domain/contracts/secret-provider.interface';

export interface DatabaseSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Onde a imagem guarda o bundle de CAs do RDS. O Dockerfile baixa o
 * `global-bundle.pem` para cá no build; `RDS_CA_BUNDLE_PATH` sobrescreve.
 */
export const DEFAULT_RDS_CA_BUNDLE_PATH = '/var/task/certs/global-bundle.pem';

/**
 * Lê o contrato de descoberta publicado pelo repositório de banco
 * (`modules/database/discovery.tf`). Os nomes finais — host, port, name,
 * username, password — são os MESMOS de lá: renomear em um lado sem o outro
 * derruba a função no cold start com ParameterNotFound.
 */
export async function loadDatabaseSettings(
  secrets: SecretProvider,
  prefix: string,
): Promise<DatabaseSettings> {
  const [host, port, database, user, password] = await Promise.all([
    secrets.get(`${prefix}/host`),
    secrets.get(`${prefix}/port`),
    secrets.get(`${prefix}/name`),
    secrets.get(`${prefix}/username`),
    secrets.get(`${prefix}/password`),
  ]);

  return { host, port: parsePort(port, prefix), database, user, password };
}

function parsePort(raw: string, prefix: string): number {
  // `Number('')` é 0 e `Number(' 5432 ')` é 5432: a regex fecha os dois antes
  // de o driver tentar conectar numa porta que ninguém publicou.
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Porta inválida em ${prefix}/port.`);
  }
  return port;
}

/**
 * Configuração do Pool para UMA conexão por container.
 *
 * - `ssl` com a CA do RDS e `rejectUnauthorized: true`: o parameter group força
 *   TLS (`rds.force_ssl = 1`); sem CA, o node-postgres ou recusa o certificado
 *   ou — pior — alguém "resolve" com `rejectUnauthorized: false` e a conexão
 *   aceita qualquer servidor.
 * - `max: 1`: cada container da Lambda atende uma requisição por vez. Pool maior
 *   só multiplica conexões ociosas contra o teto de ~110 da db.t4g.micro — é o
 *   alarme de conexões do repositório de banco que avisa se isso mudar.
 * - `statement_timeout` abaixo do timeout da função: a query cancela no banco e
 *   o handler ainda devolve 503 no contrato, em vez de a Lambda morrer por
 *   timeout e o API Gateway responder 503 genérico sem correlationId.
 */
export function buildPoolConfig(settings: DatabaseSettings, caBundle: string): PoolConfig {
  if (!caBundle.includes('BEGIN CERTIFICATE')) {
    throw new Error('Bundle de CA do RDS vazio ou inválido.');
  }

  return {
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    ssl: { ca: caBundle, rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 60_000,
    statement_timeout: 3_000,
    query_timeout: 4_000,
    application_name: 'techchallenge-auth-lambda',
  };
}

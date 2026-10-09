import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { PoolConfig } from 'pg';
import type { SecretProvider } from '../../domain/contracts/secret-provider.interface';
import type { AuthLogEntry, Logger } from '../logging/logger';
import type { SqlClient } from '../repositories/pg-customer.repository';
import { composeAuthHandler } from './auth-composition';

const JWT_PATH = '/techchallenge/staging/auth/jwt-secret';
const DB_PREFIX = '/techchallenge/staging/db';
const SECRET = 'staging-jwt-secret-with-32-chars-or-more';
const CA = '-----BEGIN CERTIFICATE-----\nMIIsintetico\n-----END CERTIFICATE-----\n';
const CUSTOMER_ID = '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30';

const ENV = {
  APP_ENV: 'staging',
  DB_SSM_PREFIX: DB_PREFIX,
  JWT_SECRET_SSM_PATH: JWT_PATH,
};

class SecretsStub implements SecretProvider {
  reads: string[] = [];
  values: Record<string, string> = {
    [JWT_PATH]: SECRET,
    [`${DB_PREFIX}/host`]: 'db.interno',
    [`${DB_PREFIX}/port`]: '5432',
    [`${DB_PREFIX}/name`]: 'oficinadb',
    [`${DB_PREFIX}/username`]: 'techchallenge',
    [`${DB_PREFIX}/password`]: 'senha-sintetica',
  };

  get(path: string): Promise<string> {
    this.reads.push(path);
    const value = this.values[path];
    return value === undefined ? Promise.reject(new Error(`sem ${path}`)) : Promise.resolve(value);
  }
}

class SqlClientStub implements SqlClient {
  query<T>(): Promise<{ rows: T[] }> {
    return Promise.resolve({
      rows: [{ id: CUSTOMER_ID, status: 'ACTIVE', deleted_at: null }] as T[],
    });
  }
}

class SilentLogger implements Logger {
  entries: AuthLogEntry[] = [];
  write(_level: 'info' | 'warn' | 'error', entry: AuthLogEntry): void {
    this.entries.push(entry);
  }
}

function ports(overrides: { env?: NodeJS.ProcessEnv; secrets?: SecretsStub } = {}) {
  const pools: PoolConfig[] = [];
  const caReads: string[] = [];
  return {
    pools,
    caReads,
    value: {
      env: overrides.env ?? ENV,
      secrets: overrides.secrets ?? new SecretsStub(),
      logger: new SilentLogger(),
      readCaBundle: (path: string) => {
        caReads.push(path);
        return CA;
      },
      createSqlClient: (config: PoolConfig) => {
        pools.push(config);
        return new SqlClientStub();
      },
    },
  };
}

function httpEvent(cpf: string): APIGatewayProxyEventV2 {
  return {
    headers: {},
    requestContext: { requestId: 'req-1' },
    isBase64Encoded: false,
    body: JSON.stringify({ cpf }),
  } as unknown as APIGatewayProxyEventV2;
}

describe('composeAuthHandler', () => {
  it('monta o fluxo real: CPF válido vira JWT assinado com o segredo do SSM', async () => {
    const { value } = ports();
    const handler = await composeAuthHandler(value);

    const result = await handler(httpEvent('111.444.777-35'));
    expect(result.statusCode).toBe(200);

    const token = (JSON.parse(result.body ?? '{}') as { access_token: string }).access_token;
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as JwtPayload;
    expect(payload.sub).toBe(CUSTOMER_ID);
  });

  it('lê cada parâmetro do SSM uma única vez no bootstrap', async () => {
    const secrets = new SecretsStub();
    await composeAuthHandler(ports({ secrets }).value);

    expect([...secrets.reads].sort()).toEqual(
      [
        JWT_PATH,
        `${DB_PREFIX}/host`,
        `${DB_PREFIX}/name`,
        `${DB_PREFIX}/password`,
        `${DB_PREFIX}/port`,
        `${DB_PREFIX}/username`,
      ].sort(),
    );
  });

  it('cria UM pool com TLS verificado e as credenciais do SSM', async () => {
    const { value, pools } = ports();
    await composeAuthHandler(value);

    expect(pools).toHaveLength(1);
    expect(pools[0]).toMatchObject({
      host: 'db.interno',
      port: 5432,
      password: 'senha-sintetica',
      max: 1,
      ssl: { ca: CA, rejectUnauthorized: true },
    });
  });

  it('lê a CA do caminho padrão da imagem, ou de RDS_CA_BUNDLE_PATH quando definido', async () => {
    const padrao = ports();
    await composeAuthHandler(padrao.value);
    expect(padrao.caReads).toEqual(['/var/task/certs/global-bundle.pem']);

    const custom = ports({ env: { ...ENV, RDS_CA_BUNDLE_PATH: '/tmp/ca.pem' } });
    await composeAuthHandler(custom.value);
    expect(custom.caReads).toEqual(['/tmp/ca.pem']);
  });

  it('variável ausente falha ANTES de qualquer chamada ao SSM', async () => {
    const secrets = new SecretsStub();
    const env: NodeJS.ProcessEnv = { APP_ENV: 'staging', JWT_SECRET_SSM_PATH: JWT_PATH };

    await expect(composeAuthHandler(ports({ env, secrets }).value)).rejects.toThrow(
      'Variável obrigatória ausente: DB_SSM_PREFIX',
    );
    expect(secrets.reads).toHaveLength(0);
  });

  it('segredo JWT curto no SSM derruba o bootstrap e nenhum pool é criado', async () => {
    const secrets = new SecretsStub();
    secrets.values[JWT_PATH] = 'curto';
    const { value, pools } = ports({ secrets });

    await expect(composeAuthHandler(value)).rejects.toThrow(/mínimo 32 caracteres/);
    expect(pools).toHaveLength(0);
  });

  it('parâmetro do banco ainda não publicado derruba o bootstrap', async () => {
    const secrets = new SecretsStub();
    delete secrets.values[`${DB_PREFIX}/password`];

    await expect(composeAuthHandler(ports({ secrets }).value)).rejects.toThrow(
      `sem ${DB_PREFIX}/password`,
    );
  });
});

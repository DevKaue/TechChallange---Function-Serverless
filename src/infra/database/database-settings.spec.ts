import type { SecretProvider } from '../../domain/contracts/secret-provider.interface';
import {
  buildPoolConfig,
  loadDatabaseSettings,
  type DatabaseSettings,
} from './database-settings';

const PREFIX = '/techchallenge/homolog/db';
const CA = '-----BEGIN CERTIFICATE-----\nMIIsintetico\n-----END CERTIFICATE-----\n';

class SecretsStub implements SecretProvider {
  reads: string[] = [];
  values: Record<string, string> = {
    [`${PREFIX}/host`]: 'db.interno',
    [`${PREFIX}/port`]: '5432',
    [`${PREFIX}/name`]: 'oficinadb',
    [`${PREFIX}/username`]: 'techchallenge',
    [`${PREFIX}/password`]: 'senha-sintetica',
  };

  get(path: string): Promise<string> {
    this.reads.push(path);
    const value = this.values[path];
    return value === undefined
      ? Promise.reject(Object.assign(new Error('not found'), { name: 'ParameterNotFound' }))
      : Promise.resolve(value);
  }
}

const SETTINGS: DatabaseSettings = {
  host: 'db.interno',
  port: 5432,
  database: 'oficinadb',
  user: 'techchallenge',
  password: 'senha-sintetica',
};

describe('loadDatabaseSettings', () => {
  it('lê os cinco parâmetros do contrato de descoberta do repositório de banco', async () => {
    const secrets = new SecretsStub();

    await expect(loadDatabaseSettings(secrets, PREFIX)).resolves.toEqual(SETTINGS);
    expect([...secrets.reads].sort()).toEqual(
      ['host', 'name', 'password', 'port', 'username'].map((k) => `${PREFIX}/${k}`),
    );
  });

  it.each(['', 'abc', '0', '70000', ' 5432', '5432.0', '-1'])(
    'recusa porta publicada como "%s"',
    async (port) => {
      const secrets = new SecretsStub();
      secrets.values[`${PREFIX}/port`] = port;

      await expect(loadDatabaseSettings(secrets, PREFIX)).rejects.toThrow(
        `Porta inválida em ${PREFIX}/port.`,
      );
    },
  );

  it('propaga parâmetro ausente, sem inventar default', async () => {
    const secrets = new SecretsStub();
    delete secrets.values[`${PREFIX}/password`];

    await expect(loadDatabaseSettings(secrets, PREFIX)).rejects.toMatchObject({
      name: 'ParameterNotFound',
    });
  });
});

describe('buildPoolConfig', () => {
  it('exige TLS verificado com a CA do RDS', () => {
    const config = buildPoolConfig(SETTINGS, CA);
    expect(config.ssl).toEqual({ ca: CA, rejectUnauthorized: true });
  });

  it('usa uma conexão por container e timeouts abaixo do da função', () => {
    const config = buildPoolConfig(SETTINGS, CA);

    expect(config.max).toBe(1);
    expect(config.statement_timeout).toBe(3_000);
    expect(config.query_timeout).toBeGreaterThan(3_000);
    expect(config.connectionTimeoutMillis).toBeLessThanOrEqual(3_000);
  });

  it('repassa exatamente as credenciais lidas do SSM', () => {
    expect(buildPoolConfig(SETTINGS, CA)).toMatchObject({
      host: 'db.interno',
      port: 5432,
      database: 'oficinadb',
      user: 'techchallenge',
      password: 'senha-sintetica',
    });
  });

  it.each(['', 'arquivo de texto qualquer'])('recusa bundle de CA inválido (%p)', (ca) => {
    expect(() => buildPoolConfig(SETTINGS, ca)).toThrow('Bundle de CA do RDS vazio ou inválido.');
  });
});

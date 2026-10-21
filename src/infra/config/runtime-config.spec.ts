import { loadRuntimeConfig } from './runtime-config';

const VALID_ENV = {
  APP_ENV: 'staging',
  DB_SSM_PREFIX: '/techchallenge/staging/db',
  JWT_SECRET_SSM_PATH: '/techchallenge/staging/auth/jwt-secret',
};

describe('loadRuntimeConfig', () => {
  it('carrega apenas paths e metadados não secretos', () => {
    expect(loadRuntimeConfig(VALID_ENV)).toEqual({
      appEnv: 'staging',
      dbSsmPrefix: '/techchallenge/staging/db',
      jwtSecretSsmPath: '/techchallenge/staging/auth/jwt-secret',
    });
  });

  it.each(['APP_ENV', 'DB_SSM_PREFIX', 'JWT_SECRET_SSM_PATH'])(
    'falha no cold start quando %s está ausente',
    (name) => {
      const env = { ...VALID_ENV };
      delete env[name as keyof typeof env];
      expect(() => loadRuntimeConfig(env)).toThrow(`Variável obrigatória ausente: ${name}`);
    },
  );

  it.each([
    ['DB_SSM_PREFIX', 'techchallenge/staging/db'],
    ['DB_SSM_PREFIX', '/techchallenge//staging/db'],
    ['JWT_SECRET_SSM_PATH', '/techchallenge/staging/auth/'],
  ])('recusa path SSM não normalizado em %s', (name, value) => {
    expect(() => loadRuntimeConfig({ ...VALID_ENV, [name]: value })).toThrow(
      `${name} precisa ser um path SSM absoluto e normalizado.`,
    );
  });
});

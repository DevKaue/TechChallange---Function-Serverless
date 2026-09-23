import { loadRuntimeConfig } from './runtime-config';

const VALID_ENV = {
  APP_ENV: 'homolog',
  DB_SSM_PREFIX: '/techchallenge/homolog/db',
  JWT_SECRET_SSM_PATH: '/techchallenge/homolog/auth/jwt-secret',
};

describe('loadRuntimeConfig', () => {
  it('carrega apenas paths e metadados não secretos', () => {
    expect(loadRuntimeConfig(VALID_ENV)).toEqual({
      appEnv: 'homolog',
      dbSsmPrefix: '/techchallenge/homolog/db',
      jwtSecretSsmPath: '/techchallenge/homolog/auth/jwt-secret',
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
    ['DB_SSM_PREFIX', 'techchallenge/homolog/db'],
    ['DB_SSM_PREFIX', '/techchallenge//homolog/db'],
    ['JWT_SECRET_SSM_PATH', '/techchallenge/homolog/auth/'],
  ])('recusa path SSM não normalizado em %s', (name, value) => {
    expect(() => loadRuntimeConfig({ ...VALID_ENV, [name]: value })).toThrow(
      `${name} precisa ser um path SSM absoluto e normalizado.`,
    );
  });
});

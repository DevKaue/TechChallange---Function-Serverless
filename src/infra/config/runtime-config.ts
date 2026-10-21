export interface RuntimeConfig {
  appEnv: string;
  dbSsmPrefix: string;
  jwtSecretSsmPath: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`Variável obrigatória ausente: ${name}`);
  }
  return value;
}

function ssmPath(value: string, name: string): string {
  if (!value.startsWith('/') || value.endsWith('/') || value.includes('//')) {
    throw new Error(`${name} precisa ser um path SSM absoluto e normalizado.`);
  }
  return value;
}

/**
 * Lê somente nomes de recursos. Segredos e endpoints continuam fora da
 * configuração da função e são resolvidos pelo SSM durante o cold start.
 */
export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    appEnv: required(env, 'APP_ENV'),
    dbSsmPrefix: ssmPath(required(env, 'DB_SSM_PREFIX'), 'DB_SSM_PREFIX'),
    jwtSecretSsmPath: ssmPath(
      required(env, 'JWT_SECRET_SSM_PATH'),
      'JWT_SECRET_SSM_PATH',
    ),
  };
}

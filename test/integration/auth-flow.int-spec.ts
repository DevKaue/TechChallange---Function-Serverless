import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import authResponseSchema from '../../contracts/auth-response.schema.json';
import errors from '../../contracts/errors.json';
import tokenSchema from '../../contracts/customer-access-token.schema.json';
import { AuthenticateCustomerUseCase } from '../../src/application/usecases/authenticate-customer.usecase';
import { createAuthHttpHandler } from '../../src/infra/http/auth-http.handler';
import { ConsoleJsonLogger } from '../../src/infra/logging/logger';
import { PgCustomerRepository } from '../../src/infra/repositories/pg-customer.repository';
import { JsonWebTokenService } from '../../src/infra/security/jsonwebtoken-token.service';
import { RandomUuidGenerator } from '../../src/infra/security/random-uuid.generator';
import {
  CPF_NUNCA_CADASTRADO,
  CUSTOMERS_DDL,
  SEED,
  asSqlClient,
  createIsolatedSchema,
  seed,
  type IsolatedSchema,
} from './support/database';

const SECRET = 'integration-jwt-secret-with-32-chars-min';

function httpEvent(body: unknown, correlationId?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /auth',
    rawPath: '/auth',
    rawQueryString: '',
    headers: correlationId === undefined ? {} : { 'x-correlation-id': correlationId },
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'example.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'example',
      http: {
        method: 'POST',
        path: '/auth',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'jest-integration',
      },
      requestId: 'integration-request-id',
      routeKey: 'POST /auth',
      stage: '$default',
      time: '27/Sep/2026:12:00:00 +0000',
      timeEpoch: 1_790_510_400_000,
    },
    isBase64Encoded: false,
    body: JSON.stringify(body),
  };
}

/** Evento v1.0 como o plugin aws-lambda do Kong envia (body em base64). */
function kongEvent(payload: unknown, correlationId: string): APIGatewayProxyEvent {
  return {
    resource: '/auth',
    path: '/auth',
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: { requestId: 'kong-integration-request-id' },
    isBase64Encoded: true,
    body: Buffer.from(JSON.stringify(payload)).toString('base64'),
  } as unknown as APIGatewayProxyEvent;
}

function body(result: { body?: string | undefined }): Record<string, unknown> {
  return JSON.parse(result.body ?? '{}') as Record<string, unknown>;
}

/**
 * Fluxo inteiro SEM MOCK de regra: evento do gateway → handler → caso de uso
 * → repositório `pg` → Postgres real → `jsonwebtoken`. Só o console é espionado,
 * para provar a regra "CPF nunca vai para log" na saída que o CloudWatch
 * realmente recebe — e não num LoggerSpy.
 */
describe('Fluxo de autenticação ponta a ponta (sem gateway)', () => {
  let db: IsolatedSchema;
  let handler: ReturnType<typeof createAuthHttpHandler>;
  let stdout: jest.SpyInstance;

  beforeAll(async () => {
    db = await createIsolatedSchema(CUSTOMERS_DDL);
    await seed(db.client, Object.values(SEED));

    const useCase = new AuthenticateCustomerUseCase(
      new PgCustomerRepository(asSqlClient(db.client)),
      new JsonWebTokenService(SECRET),
      new RandomUuidGenerator(),
    );
    handler = createAuthHttpHandler(useCase, new ConsoleJsonLogger());
  });

  afterAll(async () => {
    await db.dispose();
  });

  beforeEach(() => {
    stdout = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  function logLines(): Array<Record<string, unknown>> {
    return stdout.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
  }

  it('cliente ativo recebe 200 com um JWT cujo sub é o id do banco', async () => {
    const result = await handler(httpEvent({ cpf: '111.444.777-35' }, 'it-feliz-1'));

    expect(result.statusCode).toBe(200);

    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    expect(ajv.validate(authResponseSchema, body(result))).toBe(true);

    const token = body(result).access_token as string;
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as JwtPayload;
    expect(ajv.validate(tokenSchema, payload)).toBe(true);
    expect(payload.sub).toBe(SEED.ativo.id);
    expect(payload.exp! - payload.iat!).toBe(3600);
  });

  it('evento v1.0 do Kong segue o mesmo fluxo e emite o mesmo contrato de token', async () => {
    const result = await handler(kongEvent({ cpf: '111.444.777-35' }, 'kong-uuid#7'));

    expect(result.statusCode).toBe(200);
    expect(result.headers['x-correlation-id']).toBe('kong-uuid#7');
    const token = body(result).access_token as string;
    const payload = jwt.verify(token, SECRET, {
      algorithms: ['HS256'],
      issuer: 'techchallenge-auth-lambda',
    }) as JwtPayload;
    expect(payload.sub).toBe(SEED.ativo.id);
    expect(payload.type).toBe('customer');
  });

  it('duas autenticações seguidas geram jti diferentes', async () => {
    const primeira = body(await handler(httpEvent({ cpf: '11144477735' })));
    const segunda = body(await handler(httpEvent({ cpf: '11144477735' })));

    const jti = (r: Record<string, unknown>) => (jwt.decode(r.access_token as string) as JwtPayload).jti;
    expect(jti(primeira)).not.toBe(jti(segunda));
  });

  it.each([
    ['nunca cadastrado', CPF_NUNCA_CADASTRADO, 'not_found'],
    ['cadastrado só como RNE', SEED.soComoRne.document, 'not_found'],
    ['arquivado', SEED.arquivado.document, 'archived'],
    ['inativo', SEED.inativo.document, 'inactive'],
    ['bloqueado', SEED.bloqueado.document, 'blocked'],
  ])('%s: 401 idêntico por fora, motivo real só no log', async (_caso, cpf, reason) => {
    const result = await handler(httpEvent({ cpf }, `it-negado-${reason}`));

    expect(result.statusCode).toBe(errors.customer_not_found.httpStatus);
    expect(body(result)).toEqual({
      error: errors.customer_not_found.error,
      message: errors.customer_not_found.publicMessage,
      correlationId: `it-negado-${reason}`,
    });
    expect(logLines()).toContainEqual(
      expect.objectContaining({ event: 'auth.denied', reason, correlationId: `it-negado-${reason}` }),
    );
  });

  it('CPF com DV inválido devolve 400 e não chega a consultar o banco', async () => {
    const result = await handler(httpEvent({ cpf: '11144477734' }));

    expect(result.statusCode).toBe(errors.invalid_cpf.httpStatus);
    expect(logLines().map((l) => l.event)).not.toContain('db.error');
  });

  it('nenhuma linha de log, em nenhum desfecho, contém o CPF em qualquer formato', async () => {
    const cpfs = [
      SEED.ativo.document,
      SEED.bloqueado.document,
      CPF_NUNCA_CADASTRADO,
      '11144477734',
    ];
    for (const cpf of cpfs) {
      await handler(httpEvent({ cpf }));
    }

    const saida = stdout.mock.calls.map(([line]) => String(line)).join('\n');
    for (const cpf of cpfs) {
      const comMascaraOuNao = new RegExp(
        `${cpf.slice(0, 3)}\\.?${cpf.slice(3, 6)}\\.?${cpf.slice(6, 9)}-?${cpf.slice(9)}`,
      );
      expect(saida).not.toMatch(comMascaraOuNao);
    }
  });
});

describe('Fluxo de autenticação com o RDS recém-criado (antes da migration)', () => {
  it('devolve 503 no contrato, nunca 200 nem 500', async () => {
    const db = await createIsolatedSchema();
    const stdout = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const handler = createAuthHttpHandler(
        new AuthenticateCustomerUseCase(
          new PgCustomerRepository(asSqlClient(db.client)),
          new JsonWebTokenService(SECRET),
          new RandomUuidGenerator(),
        ),
        new ConsoleJsonLogger(),
      );

      const result = await handler(httpEvent({ cpf: SEED.ativo.document }));

      expect(result.statusCode).toBe(errors.data_source_unavailable.httpStatus);
      expect(body(result)).toMatchObject({
        error: errors.data_source_unavailable.error,
        message: errors.data_source_unavailable.publicMessage,
      });
      const saida = stdout.mock.calls.map(([line]) => String(line)).join('\n');
      expect(saida).toContain('"errorCode":"42P01"');
      expect(saida).not.toContain('does not exist');
    } finally {
      stdout.mockRestore();
      await db.dispose();
    }
  });
});

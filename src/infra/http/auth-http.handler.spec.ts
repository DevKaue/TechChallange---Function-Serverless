import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type {
  AuthenticateCustomerInput,
  AuthenticateCustomerOutput,
} from '../../application/dtos/authenticate-customer.dto';
import { CustomerNotAuthorizedError } from '../../domain/errors/customer-not-authorized.error';
import { DataSourceUnavailableError } from '../../domain/errors/data-source-unavailable.error';
import { InvalidCpfError } from '../../domain/errors/invalid-cpf.error';
import type { AuthLogEntry, Logger } from '../logging/logger';
import { createAuthHttpHandler } from './auth-http.handler';

const REQUEST_ID = 'api-gateway-request-id';

function event(
  body: string | undefined,
  options: {
    headers?: Record<string, string>;
    isBase64Encoded?: boolean;
  } = {},
): APIGatewayProxyEventV2 {
  const base: APIGatewayProxyEventV2 = {
    version: '2.0',
    routeKey: 'POST /auth',
    rawPath: '/auth',
    rawQueryString: '',
    headers: options.headers ?? {},
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
        userAgent: 'jest',
      },
      requestId: REQUEST_ID,
      routeKey: 'POST /auth',
      stage: '$default',
      time: '23/Sep/2026:12:00:00 +0000',
      timeEpoch: 1_790_163_200_000,
    },
    isBase64Encoded: options.isBase64Encoded ?? false,
  };

  // Com exactOptionalPropertyTypes, propriedade ausente é diferente de
  // propriedade presente com `undefined` — exatamente como o evento real.
  return body === undefined ? base : { ...base, body };
}

class UseCaseStub {
  inputs: AuthenticateCustomerInput[] = [];
  result: AuthenticateCustomerOutput = {
    access_token: 'jwt-assinado',
    token_type: 'Bearer',
    expires_in: 3600,
  };
  failure: Error | undefined;

  execute(input: AuthenticateCustomerInput): Promise<AuthenticateCustomerOutput> {
    this.inputs.push(input);
    return this.failure === undefined ? Promise.resolve(this.result) : Promise.reject(this.failure);
  }
}

class LoggerSpy implements Logger {
  entries: Array<{ level: 'info' | 'warn' | 'error'; entry: AuthLogEntry }> = [];

  write(level: 'info' | 'warn' | 'error', entry: AuthLogEntry): void {
    this.entries.push({ level, entry });
  }
}

function parsedBody(result: { body?: string | undefined }): Record<string, unknown> {
  return JSON.parse(result.body ?? '{}') as Record<string, unknown>;
}

describe('createAuthHttpHandler', () => {
  let useCase: UseCaseStub;
  let logger: LoggerSpy;
  let clock: jest.Mock<number, []>;

  beforeEach(() => {
    useCase = new UseCaseStub();
    logger = new LoggerSpy();
    clock = jest.fn<number, []>().mockReturnValueOnce(100).mockReturnValue(115);
  });

  it('devolve 200 no contrato e propaga correlation id válido', async () => {
    const handler = createAuthHttpHandler(useCase, logger, clock);
    const result = await handler(
      event(JSON.stringify({ cpf: '111.444.777-35' }), {
        headers: { 'X-Correlation-ID': 'checkout-123' },
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
      'x-correlation-id': 'checkout-123',
    });
    expect(parsedBody(result)).toEqual(useCase.result);
    expect(useCase.inputs).toEqual([{ cpf: '111.444.777-35' }]);
    expect(logger.entries.at(-1)).toMatchObject({
      level: 'info',
      entry: {
        event: 'auth.success',
        correlationId: 'checkout-123',
        durationMs: 15,
        coldStart: true,
      },
    });
  });

  it('usa requestId quando o correlation id está ausente ou é inseguro', async () => {
    const handler = createAuthHttpHandler(useCase, logger);

    const absent = await handler(event(JSON.stringify({ cpf: '11144477735' })));
    const unsafe = await handler(
      event(JSON.stringify({ cpf: '11144477735' }), {
        headers: { 'x-correlation-id': 'quebra\nde\nlog' },
      }),
    );

    expect(absent.headers).toMatchObject({ 'x-correlation-id': REQUEST_ID });
    expect(unsafe.headers).toMatchObject({ 'x-correlation-id': REQUEST_ID });
  });

  it('decodifica body base64 do payload 2.0', async () => {
    const handler = createAuthHttpHandler(useCase, logger);
    const encoded = Buffer.from(JSON.stringify({ cpf: '11144477735' })).toString('base64');

    await handler(event(encoded, { isBase64Encoded: true }));

    expect(useCase.inputs).toEqual([{ cpf: '11144477735' }]);
  });

  it.each([
    ['JSON malformado', '{"cpf":'],
    ['body ausente', undefined],
    ['body não-objeto', '"11144477735"'],
  ])('%s vira 400 no nosso formato, nunca 502', async (_scenario, body) => {
    if (body !== '{"cpf":') useCase.failure = new InvalidCpfError('inválido');
    const handler = createAuthHttpHandler(useCase, logger);

    const result = await handler(event(body));

    expect(result.statusCode).toBe(400);
    expect(parsedBody(result)).toEqual({
      error: 'invalid_request',
      message: 'CPF inválido',
      correlationId: REQUEST_ID,
    });
  });

  it.each(['not_found', 'archived', 'inactive', 'blocked'] as const)(
    '%s devolve o mesmo 401 e deixa o motivo só no log',
    async (reason) => {
      useCase.failure = new CustomerNotAuthorizedError(reason);
      const handler = createAuthHttpHandler(useCase, logger);

      const result = await handler(event(JSON.stringify({ cpf: '55566677720' })));

      expect(result.statusCode).toBe(401);
      expect(parsedBody(result)).toEqual({
        error: 'unauthorized',
        message: 'CPF não autorizado',
        correlationId: REQUEST_ID,
      });
      expect(logger.entries.at(-1)).toMatchObject({
        level: 'warn',
        entry: { event: 'auth.denied', reason },
      });
    },
  );

  it('indisponibilidade vira 503 e registra apenas o código seguro da causa', async () => {
    const cause = Object.assign(new Error('relation "customers" does not exist'), {
      code: '42P01',
    });
    useCase.failure = new DataSourceUnavailableError('interno', cause);
    const handler = createAuthHttpHandler(useCase, logger);

    const result = await handler(event(JSON.stringify({ cpf: '11144477735' })));

    expect(result.statusCode).toBe(503);
    expect(parsedBody(result)).toEqual({
      error: 'service_unavailable',
      message: 'Serviço temporariamente indisponível',
      correlationId: REQUEST_ID,
    });
    expect(logger.entries.at(-1)).toMatchObject({
      level: 'error',
      entry: { event: 'db.error', errorCode: '42P01' },
    });
    expect(JSON.stringify(logger.entries)).not.toContain(
      'relation "customers" does not exist',
    );
  });

  it('erro inesperado vira 500 controlado, nunca exceção/502', async () => {
    useCase.failure = new Error('segredo que não pode vazar');
    const handler = createAuthHttpHandler(useCase, logger);

    await expect(handler(event(JSON.stringify({ cpf: '11144477735' })))).resolves.toMatchObject({
      statusCode: 500,
    });
    expect(JSON.stringify(logger.entries)).not.toContain('segredo que não pode vazar');
  });

  it('CPF nunca aparece em nenhuma linha de log, nem no caminho feliz nem no erro', async () => {
    const handler = createAuthHttpHandler(useCase, logger);
    await handler(event(JSON.stringify({ cpf: '111.444.777-35' })));

    expect(JSON.stringify(logger.entries)).not.toMatch(/111[.\d-]*444[.\d-]*777/);
  });

  it('marca coldStart somente na primeira invocação do container', async () => {
    const handler = createAuthHttpHandler(useCase, logger);
    await handler(event(JSON.stringify({ cpf: '11144477735' })));
    await handler(event(JSON.stringify({ cpf: '11144477735' })));

    const attempts = logger.entries.filter(({ entry }) => entry.event === 'auth.attempt');
    expect(attempts.map(({ entry }) => entry.coldStart)).toEqual([true, false]);
  });
});

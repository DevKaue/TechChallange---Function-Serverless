import type { APIGatewayRequestAuthorizerEventV2 } from 'aws-lambda';
import type { AuthLogEntry, Logger } from '../logging/logger';
import type { TokenVerification } from '../security/jsonwebtoken-token.verifier';
import { createAuthorizerHandler } from './authorizer-http.handler';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.assinatura_sintetica-1';
const CUSTOMER_ID = '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30';

function event(headers?: Record<string, string>): APIGatewayRequestAuthorizerEventV2 {
  const base = {
    version: '2.0',
    type: 'REQUEST',
    routeArn: 'arn:aws:execute-api:us-east-1:123456789012:api-id/$default/GET/service-orders',
    identitySource: headers?.authorization === undefined ? [] : [headers.authorization],
    routeKey: 'GET /service-orders',
    rawPath: '/service-orders',
    rawQueryString: '',
    cookies: [],
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'example.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'example',
      http: {
        method: 'GET',
        path: '/service-orders',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'jest',
      },
      requestId: 'authz-request-id',
      routeKey: 'GET /service-orders',
      stage: '$default',
      time: '27/Sep/2026:12:00:00 +0000',
      timeEpoch: 1_790_510_400_000,
    },
  };
  return (headers === undefined ? base : { ...base, headers }) as unknown as APIGatewayRequestAuthorizerEventV2;
}

class VerifierStub {
  tokens: string[] = [];
  result: TokenVerification = { valid: true, customerId: CUSTOMER_ID };
  failure: Error | undefined;

  verify(token: string): TokenVerification {
    this.tokens.push(token);
    if (this.failure !== undefined) throw this.failure;
    return this.result;
  }
}

class LoggerSpy implements Logger {
  entries: Array<{ level: 'info' | 'warn' | 'error'; entry: AuthLogEntry }> = [];

  write(level: 'info' | 'warn' | 'error', entry: AuthLogEntry): void {
    this.entries.push({ level, entry });
  }
}

describe('createAuthorizerHandler', () => {
  let verifier: VerifierStub;
  let logger: LoggerSpy;

  beforeEach(() => {
    verifier = new VerifierStub();
    logger = new LoggerSpy();
  });

  it('libera token válido e repassa só customerId e tipo para a integração', async () => {
    const handler = createAuthorizerHandler(verifier, logger);

    await expect(handler(event({ authorization: `Bearer ${TOKEN}` }))).resolves.toEqual({
      isAuthorized: true,
      context: { customerId: CUSTOMER_ID, principalType: 'customer' },
    });
    expect(verifier.tokens).toEqual([TOKEN]);
    expect(logger.entries.at(-1)).toMatchObject({
      level: 'info',
      entry: { event: 'authz.allowed', customerId: CUSTOMER_ID },
    });
  });

  it.each([
    ['minúsculo', `bearer ${TOKEN}`],
    ['maiúsculo', `BEARER ${TOKEN}`],
    ['espaços extras', `  Bearer   ${TOKEN}  `],
  ])('aceita o esquema Bearer %s (RFC 7235)', async (_caso, header) => {
    const handler = createAuthorizerHandler(verifier, logger);
    await expect(handler(event({ authorization: header }))).resolves.toMatchObject({
      isAuthorized: true,
    });
  });

  it('acha o header independente da caixa do nome', async () => {
    const handler = createAuthorizerHandler(verifier, logger);
    await expect(handler(event({ Authorization: `Bearer ${TOKEN}` }))).resolves.toMatchObject({
      isAuthorized: true,
    });
  });

  it.each([
    ['sem headers', undefined, 'missing_token'],
    ['sem Authorization', {}, 'missing_token'],
    ['Authorization vazio', { authorization: '   ' }, 'missing_token'],
    ['esquema Basic', { authorization: 'Basic dXNlcjpwYXNz' }, 'malformed_header'],
    ['Bearer sem token', { authorization: 'Bearer' }, 'malformed_header'],
    ['token com dois segmentos', { authorization: 'Bearer abc.def' }, 'malformed_header'],
    ['token com caractere fora do base64url', { authorization: 'Bearer a.b.c;d' }, 'malformed_header'],
  ])('%s: nega sem chamar o verificador', async (_caso, headers, reason) => {
    const handler = createAuthorizerHandler(verifier, logger);

    await expect(handler(event(headers))).resolves.toEqual({ isAuthorized: false });
    expect(verifier.tokens).toHaveLength(0);
    expect(logger.entries.at(-1)).toMatchObject({
      level: 'warn',
      entry: { event: 'authz.denied', reason },
    });
  });

  it.each(['expired', 'wrong_issuer', 'wrong_type', 'invalid_signature_or_alg', 'malformed'] as const)(
    'recusa do verificador (%s) nega e registra o motivo',
    async (reason) => {
      verifier.result = { valid: false, reason };
      const handler = createAuthorizerHandler(verifier, logger);

      await expect(handler(event({ authorization: `Bearer ${TOKEN}` }))).resolves.toEqual({
        isAuthorized: false,
      });
      expect(logger.entries.at(-1)?.entry.reason).toBe(reason);
    },
  );

  it('erro inesperado no verificador NEGA, nunca lança (exceção vira 500 no API Gateway)', async () => {
    verifier.failure = new Error('bug');
    const handler = createAuthorizerHandler(verifier, logger);

    await expect(handler(event({ authorization: `Bearer ${TOKEN}` }))).resolves.toEqual({
      isAuthorized: false,
    });
    expect(logger.entries.at(-1)).toMatchObject({
      level: 'error',
      entry: { event: 'authz.error', reason: 'unexpected' },
    });
  });

  it('o token nunca aparece no log, nem liberado nem negado', async () => {
    const handler = createAuthorizerHandler(verifier, logger);
    await handler(event({ authorization: `Bearer ${TOKEN}` }));
    verifier.result = { valid: false, reason: 'expired' };
    await handler(event({ authorization: `Bearer ${TOKEN}` }));

    const saida = JSON.stringify(logger.entries);
    expect(saida).not.toContain(TOKEN);
    expect(saida).not.toContain(TOKEN.split('.')[0]);
  });

  it('usa o x-correlation-id válido do cliente nos logs', async () => {
    const handler = createAuthorizerHandler(verifier, logger);
    await handler(event({ authorization: `Bearer ${TOKEN}`, 'x-correlation-id': 'os-123' }));

    expect(logger.entries.at(-1)?.entry.correlationId).toBe('os-123');
  });

  it('marca coldStart só na primeira invocação e mede a duração', async () => {
    const clock = jest.fn<number, []>()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(104)
      .mockReturnValue(200);
    const handler = createAuthorizerHandler(verifier, logger, clock);

    await handler(event({ authorization: `Bearer ${TOKEN}` }));
    await handler(event({ authorization: `Bearer ${TOKEN}` }));

    expect(logger.entries.map(({ entry }) => entry.coldStart)).toEqual([true, false]);
    expect(logger.entries[0]?.entry.durationMs).toBe(4);
  });
});

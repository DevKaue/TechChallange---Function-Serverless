import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerResult,
  APIGatewaySimpleAuthorizerWithContextResult,
} from 'aws-lambda';
import type { Logger } from '../logging/logger';
import type { JsonWebTokenVerifier } from '../security/jsonwebtoken-token.verifier';
import { correlationIdFrom, getHeader } from './correlation';

/**
 * O que a integração recebe em `$context.authorizer.*` quando o acesso é
 * liberado. Só o id e o tipo — nada que exija nova consulta para ser útil, e
 * nada que seja dado pessoal.
 */
export interface CustomerAuthorizerContext {
  customerId: string;
  principalType: 'customer';
}

export type AuthorizerResult =
  | APIGatewaySimpleAuthorizerResult
  | APIGatewaySimpleAuthorizerWithContextResult<CustomerAuthorizerContext>;

// Esquema case-insensitive (RFC 7235) e token com os três segmentos base64url.
// Qualquer outra forma é negada antes de gastar CPU com HMAC.
const BEARER = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/i;

/**
 * Lambda Authorizer (HTTP API, payload 2.0, resposta simples).
 *
 * Como o handler de autenticação, este NUNCA lança: exceção num Authorizer vira
 * 500 do API Gateway para o cliente. Qualquer caminho inesperado NEGA.
 *
 * O token não entra no log em nenhuma forma — nem inteiro, nem prefixo, nem
 * hash. Quem investiga usa o correlationId e o `reason`.
 */
export function createAuthorizerHandler(
  verifier: Pick<JsonWebTokenVerifier, 'verify'>,
  logger: Logger,
  now: () => number = Date.now,
) {
  let firstInvocation = true;

  return (event: APIGatewayRequestAuthorizerEventV2): Promise<AuthorizerResult> => {
    const startedAt = now();
    const correlationId = correlationIdFrom(event);
    const requestId = event.requestContext.requestId;
    const coldStart = firstInvocation;
    firstInvocation = false;

    const deny = (reason: string, level: 'warn' | 'error' = 'warn'): Promise<AuthorizerResult> => {
      logger.write(level, {
        event: level === 'error' ? 'authz.error' : 'authz.denied',
        correlationId,
        requestId,
        outcome: level === 'error' ? 'error' : 'denied',
        durationMs: now() - startedAt,
        coldStart,
        reason,
      });
      const denied: AuthorizerResult = { isAuthorized: false };
      return Promise.resolve(denied);
    };

    try {
      const header = getHeader(event.headers, 'authorization')?.trim();
      if (header === undefined || header.length === 0) return deny('missing_token');

      const match = BEARER.exec(header);
      const token = match?.[1];
      if (token === undefined) return deny('malformed_header');

      const result = verifier.verify(token);
      if (!result.valid) return deny(result.reason);

      logger.write('info', {
        event: 'authz.allowed',
        correlationId,
        requestId,
        outcome: 'success',
        durationMs: now() - startedAt,
        coldStart,
        customerId: result.customerId,
      });

      const allowed: AuthorizerResult = {
        isAuthorized: true,
        context: { customerId: result.customerId, principalType: 'customer' },
      };
      return Promise.resolve(allowed);
    } catch {
      return deny('unexpected', 'error');
    }
  };
}

import jwt, {
  JsonWebTokenError,
  NotBeforeError,
  TokenExpiredError,
  type JwtPayload,
} from 'jsonwebtoken';
import { CUSTOMER_TOKEN_ISSUER } from '../../application/usecases/authenticate-customer.usecase';
import { MINIMUM_JWT_SECRET_LENGTH } from './jsonwebtoken-token.service';

/** Motivo da recusa, só para LOG. O Authorizer nega do mesmo jeito em todos. */
export type TokenRejection =
  | 'expired'
  | 'not_yet_valid'
  | 'invalid_signature_or_alg'
  | 'wrong_issuer'
  | 'wrong_type'
  | 'malformed';

export type TokenVerification =
  | { valid: true; customerId: string }
  | { valid: false; reason: TokenRejection };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Lado CONSUMIDOR do contrato congelado em `contracts/customer-access-token.schema.json`.
 *
 * Cada checagem fecha uma porta concreta:
 * - `algorithms: ['HS256']` — sem a lista, um token `alg: none` ou assinado com
 *   outro HS* passaria a depender do default da biblioteca;
 * - `issuer` — um JWT de USUÁRIO administrativo da aplicação principal usa o
 *   mesmo segredo e o mesmo algoritmo; sem conferir o emissor, ele abriria as
 *   rotas de cliente;
 * - `type === 'customer'` — segunda trava para o mesmo caso, independente do iss;
 * - `sub` UUID — o `sub` vai para o contexto da integração e dali para um
 *   `findById`: string arbitrária ali é entrada não validada no banco.
 */
export class JsonWebTokenVerifier {
  constructor(private readonly secret: string) {
    if (secret.length < MINIMUM_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET precisa ter no mínimo ${MINIMUM_JWT_SECRET_LENGTH} caracteres.`,
      );
    }
  }

  verify(token: string): TokenVerification {
    let decoded: string | JwtPayload;
    try {
      decoded = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: CUSTOMER_TOKEN_ISSUER,
      });
    } catch (error) {
      return { valid: false, reason: rejectionFor(error) };
    }

    if (typeof decoded === 'string') return { valid: false, reason: 'malformed' };
    if (decoded.type !== 'customer') return { valid: false, reason: 'wrong_type' };
    if (typeof decoded.sub !== 'string' || !UUID.test(decoded.sub)) {
      return { valid: false, reason: 'malformed' };
    }

    return { valid: true, customerId: decoded.sub };
  }
}

function rejectionFor(error: unknown): TokenRejection {
  // TokenExpiredError e NotBeforeError ESTENDEM JsonWebTokenError: a ordem dos
  // testes importa, senão todo token expirado aparece no log como "malformed".
  if (error instanceof TokenExpiredError) return 'expired';
  if (error instanceof NotBeforeError) return 'not_yet_valid';
  if (error instanceof JsonWebTokenError) {
    if (error.message.startsWith('jwt issuer invalid')) return 'wrong_issuer';
    if (/signature|algorithm/.test(error.message)) return 'invalid_signature_or_alg';
  }
  return 'malformed';
}

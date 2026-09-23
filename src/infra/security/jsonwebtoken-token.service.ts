import jwt from 'jsonwebtoken';
import type {
  CustomerAccessTokenPayload,
  SignedToken,
  TokenService,
} from '../../domain/contracts/token-service.interface';

export const TOKEN_EXPIRATION_SECONDS = 3600 as const;
export const MINIMUM_JWT_SECRET_LENGTH = 32;

/**
 * Assinador HS256 compatível com a aplicação principal.
 *
 * `algorithms: ['HS256']` também precisa entrar no consumidor. No estado atual,
 * o `secretOrKey` da strategy é string e o `jsonwebtoken` já restringe a
 * família HS*, então isto não fecha um exploit de `alg:none` que esteja aberto
 * hoje. A decisão congela a superfície antes de uma futura migração para
 * RS256/JWKS — classificar diferente num ADR queimaria credibilidade.
 */
export class JsonWebTokenService implements TokenService {
  constructor(private readonly secret: string) {
    // Falha no composition root (cold start), e não no meio de uma request.
    // Segredo default faria a função subir "saudável" e emitir token forjável.
    if (secret.length < MINIMUM_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET precisa ter no mínimo ${MINIMUM_JWT_SECRET_LENGTH} caracteres.`,
      );
    }
  }

  sign(payload: CustomerAccessTokenPayload): SignedToken {
    const accessToken = jwt.sign(payload, this.secret, {
      algorithm: 'HS256',
      expiresIn: TOKEN_EXPIRATION_SECONDS,
    });

    return {
      accessToken,
      expiresIn: TOKEN_EXPIRATION_SECONDS,
    };
  }
}

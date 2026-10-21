import jwt, { type JwtPayload } from 'jsonwebtoken';
import { JsonWebTokenService, TOKEN_EXPIRATION_SECONDS } from './jsonwebtoken-token.service';

const SECRET = 'ci-jwt-secret-with-at-least-32-chars';

describe('JsonWebTokenService', () => {
  it('assina somente com HS256 e expira em exatamente 3600 segundos', () => {
    const service = new JsonWebTokenService(SECRET);
    const result = service.sign({
      sub: '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30',
      type: 'customer',
      iss: 'techchallenge-auth-lambda',
      jti: '87d0ec5b-c99a-4bf5-aeca-5d9fe87dff01',
    });

    const decoded = jwt.verify(result.accessToken, SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload;
    const complete = jwt.decode(result.accessToken, { complete: true });

    expect(complete?.header).toMatchObject({ alg: 'HS256', typ: 'JWT' });
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(
      TOKEN_EXPIRATION_SECONDS,
    );
    expect(result.expiresIn).toBe(3600);
  });

  it('mantém uma allowlist estrita de claims', () => {
    const service = new JsonWebTokenService(SECRET);
    const { accessToken } = service.sign({
      sub: '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30',
      type: 'customer',
      iss: 'techchallenge-auth-lambda',
      jti: '87d0ec5b-c99a-4bf5-aeca-5d9fe87dff01',
    });

    const decoded = jwt.verify(accessToken, SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload;

    expect(Object.keys(decoded).sort()).toEqual(
      ['exp', 'iat', 'iss', 'jti', 'sub', 'type'].sort(),
    );
  });

  it('recusa segredo curto no bootstrap, antes de emitir qualquer token', () => {
    expect(() => new JsonWebTokenService('segredo-curto')).toThrow(
      /mínimo 32 caracteres/,
    );
  });

  it('token assinado por outro segredo é rejeitado', () => {
    const service = new JsonWebTokenService(SECRET);
    const { accessToken } = service.sign({
      sub: '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30',
      type: 'customer',
      iss: 'techchallenge-auth-lambda',
      jti: '87d0ec5b-c99a-4bf5-aeca-5d9fe87dff01',
    });

    expect(() =>
      jwt.verify(accessToken, 'another-secret-with-at-least-32-chars', {
        algorithms: ['HS256'],
      }),
    ).toThrow(/invalid signature/);
  });
});

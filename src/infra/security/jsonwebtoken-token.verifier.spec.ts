import jwt from 'jsonwebtoken';
import { JsonWebTokenService } from './jsonwebtoken-token.service';
import { JsonWebTokenVerifier } from './jsonwebtoken-token.verifier';

const SECRET = 'ci-jwt-secret-with-at-least-32-chars';
const CUSTOMER_ID = '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30';
const CLAIMS = {
  sub: CUSTOMER_ID,
  type: 'customer',
  iss: 'techchallenge-auth-lambda',
  jti: '87d0ec5b-c99a-4bf5-aeca-5d9fe87dff01',
};

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('JsonWebTokenVerifier', () => {
  const verifier = new JsonWebTokenVerifier(SECRET);

  it('aceita o token REAL emitido pela função de autenticação', () => {
    const { accessToken } = new JsonWebTokenService(SECRET).sign({
      sub: CUSTOMER_ID,
      type: 'customer',
      iss: 'techchallenge-auth-lambda',
      jti: CLAIMS.jti,
    });

    expect(verifier.verify(accessToken)).toEqual({ valid: true, customerId: CUSTOMER_ID });
  });

  it('recusa token expirado', () => {
    const token = jwt.sign(
      { ...CLAIMS, exp: Math.floor(Date.now() / 1000) - 10 },
      SECRET,
      { algorithm: 'HS256' },
    );
    expect(verifier.verify(token)).toEqual({ valid: false, reason: 'expired' });
  });

  it('recusa token que ainda não vale (nbf no futuro)', () => {
    const token = jwt.sign(CLAIMS, SECRET, { algorithm: 'HS256', notBefore: 600, expiresIn: 3600 });
    expect(verifier.verify(token)).toEqual({ valid: false, reason: 'not_yet_valid' });
  });

  it('recusa token assinado com outro segredo', () => {
    const token = jwt.sign(CLAIMS, 'outro-segredo-com-mais-de-32-caracteres', {
      algorithm: 'HS256',
      expiresIn: 3600,
    });
    expect(verifier.verify(token)).toEqual({ valid: false, reason: 'invalid_signature_or_alg' });
  });

  it('recusa HS512 mesmo com o segredo certo: o algoritmo é contrato', () => {
    const token = jwt.sign(CLAIMS, SECRET, { algorithm: 'HS512', expiresIn: 3600 });
    expect(verifier.verify(token)).toEqual({ valid: false, reason: 'invalid_signature_or_alg' });
  });

  it('recusa alg none, montado à mão como faria um atacante', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ ...CLAIMS, iat: now, exp: now + 3600 })}.`;
    expect(verifier.verify(token)).toEqual({ valid: false, reason: 'invalid_signature_or_alg' });
  });

  it('recusa token de outro emissor com o mesmo segredo (ex.: JWT de usuário da aplicação)', () => {
    const token = jwt.sign({ ...CLAIMS, iss: 'techchallenge-api' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: 3600,
    });
    expect(verifier.verify(token)).toEqual({ valid: false, reason: 'wrong_issuer' });
  });

  it('recusa token sem iss, que é o formato do JWT administrativo das Fases 1 e 2', () => {
    const semIss = { sub: CLAIMS.sub, type: CLAIMS.type, jti: CLAIMS.jti, role: 'ADMIN' };
    const token = jwt.sign(semIss, SECRET, {
      algorithm: 'HS256',
      expiresIn: 3600,
    });
    expect(verifier.verify(token)).toEqual({ valid: false, reason: 'wrong_issuer' });
  });

  it('recusa type diferente de customer mesmo com emissor certo', () => {
    const token = jwt.sign({ ...CLAIMS, type: 'user' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: 3600,
    });
    expect(verifier.verify(token)).toEqual({ valid: false, reason: 'wrong_type' });
  });

  it.each([
    ['sub com prefixo', `customer:${CUSTOMER_ID}`],
    ['sub vazio', ''],
    ['sub com SQL', "' OR 1=1 --"],
  ])('recusa %s', (_caso, sub) => {
    const token = jwt.sign({ ...CLAIMS, sub }, SECRET, { algorithm: 'HS256', expiresIn: 3600 });
    expect(verifier.verify(token)).toEqual({ valid: false, reason: 'malformed' });
  });

  it.each(['', 'abc', 'a.b.c', 'eyJhbGciOiJIUzI1NiJ9..'])('recusa lixo sem lançar (%p)', (token) => {
    expect(verifier.verify(token)).toMatchObject({ valid: false });
  });

  it('recusa segredo curto no bootstrap', () => {
    expect(() => new JsonWebTokenVerifier('curto')).toThrow(/mínimo 32 caracteres/);
  });
});

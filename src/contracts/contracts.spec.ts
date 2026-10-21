import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import authResponseSchema from '../../contracts/auth-response.schema.json';
import tokenSchema from '../../contracts/customer-access-token.schema.json';
import { JsonWebTokenService } from '../infra/security/jsonwebtoken-token.service';

const SECRET = 'ci-jwt-secret-with-at-least-32-chars';

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv;
}

describe('Contratos versionados', () => {
  it('aceita a resposta pública exata e recusa campo adicional', () => {
    const validate = createValidator().compile(authResponseSchema);
    const response = {
      access_token: 'jwt-assinado',
      token_type: 'Bearer',
      expires_in: 3600,
    };

    expect(validate(response)).toBe(true);
    expect(validate({ ...response, user: { name: 'dado que não pode vazar' } })).toBe(false);
  });

  it('valida o payload REAL emitido pelo assinador contra o schema', () => {
    const service = new JsonWebTokenService(SECRET);
    const { accessToken } = service.sign({
      sub: '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30',
      type: 'customer',
      iss: 'techchallenge-auth-lambda',
      jti: '87d0ec5b-c99a-4bf5-aeca-5d9fe87dff01',
    });
    const payload = jwt.verify(accessToken, SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload;
    const validate = createValidator().compile(tokenSchema);

    expect(validate(payload)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it('recusa claim nova sem alteração explícita do contrato', () => {
    const validate = createValidator().compile(tokenSchema);
    const payload = {
      sub: '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30',
      type: 'customer',
      iss: 'techchallenge-auth-lambda',
      jti: '87d0ec5b-c99a-4bf5-aeca-5d9fe87dff01',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
      cpf: 'dado-pessoal-proibido',
    };

    expect(validate(payload)).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: 'additionalProperties' }),
      ]),
    );
  });
});

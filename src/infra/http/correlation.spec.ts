import { correlationIdFrom, getHeader } from './correlation';

const REQUEST_ID = 'api-gateway-request-id';

function source(headers?: Record<string, string>) {
  return headers === undefined
    ? { requestContext: { requestId: REQUEST_ID } }
    : { headers, requestContext: { requestId: REQUEST_ID } };
}

describe('correlationIdFrom', () => {
  it('aceita exatamente 128 caracteres', () => {
    const id = 'a'.repeat(128);
    expect(correlationIdFrom(source({ 'x-correlation-id': id }))).toBe(id);
  });

  it('recusa 129 caracteres e cai para o requestId', () => {
    expect(correlationIdFrom(source({ 'x-correlation-id': 'a'.repeat(129) }))).toBe(REQUEST_ID);
  });

  it.each(['', 'com espaço', 'quebra\nde\nlinha', '{"json":1}', 'ção'])(
    'recusa %p',
    (id) => {
      expect(correlationIdFrom(source({ 'x-correlation-id': id }))).toBe(REQUEST_ID);
    },
  );

  it('aceita os separadores comuns de ids de trace', () => {
    const id = 'Root-1-5759e988:bd862e3f.fe1be4e0_abc-1';
    expect(correlationIdFrom(source({ 'X-Correlation-Id': id }))).toBe(id);
  });

  it('funciona sem headers, como no evento do Authorizer', () => {
    expect(correlationIdFrom(source())).toBe(REQUEST_ID);
  });
});

describe('getHeader', () => {
  it('ignora a caixa do nome do header', () => {
    expect(getHeader({ AUTHORIZATION: 'x' }, 'authorization')).toBe('x');
  });

  it('devolve undefined quando não há headers', () => {
    expect(getHeader(undefined, 'authorization')).toBeUndefined();
  });
});

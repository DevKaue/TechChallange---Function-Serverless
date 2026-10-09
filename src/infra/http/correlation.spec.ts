import { correlationIdFrom, getHeader } from './correlation';

const REQUEST_ID = 'gateway-request-id';

function source(headers?: Record<string, string>) {
  return headers === undefined
    ? { requestId: REQUEST_ID }
    : { headers, requestId: REQUEST_ID };
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

  it('aceita o formato uuid#counter do plugin correlation-id do Kong', () => {
    const id = '0f6c3d2e-6a1b-4c39-9a4e-0d7f5b2c8e11#3';
    expect(correlationIdFrom(source({ 'x-correlation-id': id }))).toBe(id);
  });

  it('funciona sem headers', () => {
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

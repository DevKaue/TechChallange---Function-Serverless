import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';
import { toHttpRequest } from './http-event';

function v1(overrides: Record<string, unknown>): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/auth',
    headers: { 'content-type': 'application/json' },
    body: '{"cpf":"x"}',
    isBase64Encoded: false,
    requestContext: { requestId: 'req-v1' },
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('toHttpRequest', () => {
  it('lê headers, body e requestId do v2.0', () => {
    const event = {
      version: '2.0',
      headers: { 'x-correlation-id': 'c-1' },
      body: 'e30=',
      isBase64Encoded: true,
      requestContext: { requestId: 'req-v2' },
    } as unknown as APIGatewayProxyEventV2;

    expect(toHttpRequest(event)).toEqual({
      headers: { 'x-correlation-id': 'c-1' },
      body: 'e30=',
      isBase64Encoded: true,
      requestId: 'req-v2',
    });
  });

  it('v2.0 sem body não cria a propriedade', () => {
    const event = {
      version: '2.0',
      headers: {},
      isBase64Encoded: false,
      requestContext: { requestId: 'req-v2' },
    } as unknown as APIGatewayProxyEventV2;

    expect(toHttpRequest(event)).not.toHaveProperty('body');
  });

  it('lê o v1.0 do Kong', () => {
    expect(toHttpRequest(v1({}))).toEqual({
      headers: { 'content-type': 'application/json' },
      body: '{"cpf":"x"}',
      isBase64Encoded: false,
      requestId: 'req-v1',
    });
  });

  it('headers e body null do v1.0 viram vazio e ausente', () => {
    const request = toHttpRequest(v1({ headers: null, body: null }));

    expect(request.headers).toEqual({});
    expect(request).not.toHaveProperty('body');
  });

  it('sem requestId no evento, usa o id da invocação da Lambda', () => {
    const request = toHttpRequest(v1({ requestContext: {} }), { awsRequestId: 'lambda-req' });
    expect(request.requestId).toBe('lambda-req');
  });

  it('sem requestContext nenhum, não lança', () => {
    const request = toHttpRequest(v1({ requestContext: undefined }));
    expect(request.requestId).toBe('unknown');
  });

  it('isBase64Encoded ausente é tratado como texto', () => {
    expect(toHttpRequest(v1({ isBase64Encoded: undefined })).isBase64Encoded).toBe(false);
  });
});

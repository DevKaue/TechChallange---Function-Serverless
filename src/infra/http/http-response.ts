import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export const SERVICE_UNAVAILABLE_MESSAGE = 'Serviço temporariamente indisponível';

/**
 * Toda saída HTTP passa por aqui. No payload 2.0, objeto sem `statusCode` vira
 * 200 automático do API Gateway — centralizar impede esse 200 acidental.
 */
export function jsonResponse(
  statusCode: number,
  body: object,
  correlationId: string,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-correlation-id': correlationId,
    },
    body: JSON.stringify(body),
  };
}

export function errorResponse(
  statusCode: number,
  error: string,
  message: string,
  correlationId: string,
): APIGatewayProxyStructuredResultV2 {
  return jsonResponse(statusCode, { error, message, correlationId }, correlationId);
}

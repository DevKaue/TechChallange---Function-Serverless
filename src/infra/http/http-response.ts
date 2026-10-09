export const SERVICE_UNAVAILABLE_MESSAGE = 'Serviço temporariamente indisponível';

/**
 * Mesmo formato para v1.0 e v2.0, e é o que o Kong lê com
 * `is_proxy_integration: true`. Sem `statusCode` numérico o Kong não consegue
 * montar a resposta e devolve erro de gateway; no HTTP API vira 200 automático.
 * Centralizar aqui impede as duas coisas.
 */
export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Toda saída HTTP passa por aqui. */
export function jsonResponse(
  statusCode: number,
  body: object,
  correlationId: string,
): HttpResponse {
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
): HttpResponse {
  return jsonResponse(statusCode, { error, message, correlationId }, correlationId);
}

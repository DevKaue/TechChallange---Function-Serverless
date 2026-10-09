import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, Context } from 'aws-lambda';

/**
 * Os dois formatos que chegam no POST /auth:
 * - v1.0 (REST): o que o plugin `aws-lambda` do Kong envia com
 *   `awsgateway_compatible: true` (ADR-005 do repositório da aplicação);
 * - v2.0 (HTTP API): o formato original, mantido para teste local e para não
 *   prender a função a um único gateway.
 */
export type AuthHttpEvent = APIGatewayProxyEvent | APIGatewayProxyEventV2;

export type InvocationContext = Pick<Context, 'awsRequestId'>;

/** O que o handler usa do evento, igual nos dois formatos. */
export interface HttpRequest {
  headers: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded: boolean;
  requestId: string;
}

function isV2(event: AuthHttpEvent): event is APIGatewayProxyEventV2 {
  return (event as { version?: unknown }).version === '2.0';
}

/**
 * Normaliza o evento sem confiar em campo opcional nenhum. No v1.0 `headers` e
 * `body` chegam como `null` quando ausentes, e o Kong monta o `requestContext`
 * por conta própria: um campo que ele deixe de enviar não pode virar
 * TypeError, porque exceção no handler sai como 502 do Kong, fora do contrato.
 * Sem requestId no evento, o id da invocação da Lambda é o que correlaciona.
 */
export function toHttpRequest(event: AuthHttpEvent, context?: InvocationContext): HttpRequest {
  const requestId =
    (event.requestContext as { requestId?: string } | undefined)?.requestId ??
    context?.awsRequestId ??
    'unknown';

  const headers = (event.headers ?? {}) as Record<string, string | undefined>;
  const isBase64Encoded = event.isBase64Encoded === true;
  const body = isV2(event) ? event.body : (event.body ?? undefined);

  return body === undefined || body === null
    ? { headers, isBase64Encoded, requestId }
    : { headers, body, isBase64Encoded, requestId };
}

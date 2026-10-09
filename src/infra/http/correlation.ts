const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * O que os dois eventos do API Gateway (rota e Authorizer) têm em comum. No
 * evento do Authorizer `headers` é opcional, por isso o tipo aceita ausência.
 */
export interface CorrelationSource {
  headers?: Record<string, string | undefined>;
  requestContext: { requestId: string };
}

export function getHeader(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) return undefined;
  const target = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
}

/**
 * Header controlado pelo cliente entra em log. Sem allowlist de caracteres e
 * tamanho, ele vira log injection ou cardinalidade sem limite no Datadog — por
 * isso qualquer valor fora do padrão cai para o requestId do API Gateway.
 */
export function correlationIdFrom(event: CorrelationSource): string {
  const candidate = getHeader(event.headers, 'x-correlation-id');
  return candidate !== undefined && CORRELATION_ID_PATTERN.test(candidate)
    ? candidate
    : event.requestContext.requestId;
}

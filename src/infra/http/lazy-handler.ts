import type { Logger } from '../logging/logger';
import { correlationIdFrom } from './correlation';
import { type AuthHttpEvent, type InvocationContext, toHttpRequest } from './http-event';
import { type HttpResponse, SERVICE_UNAVAILABLE_MESSAGE, errorResponse } from './http-response';

/**
 * Adia a montagem das dependências para a PRIMEIRA invocação e a reaproveita
 * nas seguintes do mesmo container.
 *
 * Por que não montar no escopo do módulo, com top-level await: se o SSM ou a
 * configuração falharem durante o init, a Lambda registra `Runtime.InitError`,
 * o gateway devolve 502 sem corpo e o container morto é reciclado em loop
 * a cada requisição. Aqui a falha vira uma resposta do contrato (503 com
 * correlationId) e a próxima invocação tenta de novo — uma falha transitória do
 * SSM não fica cacheada no container aquecido.
 */
export function createLazyHandler<E, R, C = undefined>(
  bootstrap: () => Promise<(event: E, context?: C) => Promise<R>>,
  onBootstrapFailure: (event: E, error: unknown, context?: C) => R,
): (event: E, context?: C) => Promise<R> {
  let pending: Promise<(event: E, context?: C) => Promise<R>> | undefined;

  return async (event: E, context?: C): Promise<R> => {
    if (pending === undefined) {
      // `Promise.resolve().then` captura também o throw SÍNCRONO do bootstrap
      // (ex.: variável de ambiente ausente), que de outra forma escaparia do
      // catch abaixo e viraria exceção não tratada — 502 no gateway.
      pending = Promise.resolve()
        .then(bootstrap)
        .catch((error: unknown) => {
          pending = undefined;
          throw error;
        });
    }

    let inner: (event: E, context?: C) => Promise<R>;
    try {
      inner = await pending;
    } catch (error) {
      return onBootstrapFailure(event, error, context);
    }
    return inner(event, context);
  };
}

function errorName(error: unknown): string {
  // Só o NOME vai para o log (ParameterNotFound, AccessDeniedException, Error).
  // A mensagem pode trazer path, ARN ou host — o motivo detalhado fica no
  // CloudWatch do próprio SDK, não no log estruturado que vai para o Datadog.
  return error instanceof Error ? error.name : 'unknown';
}

export function authBootstrapFailure(logger: Logger) {
  return (event: AuthHttpEvent, error: unknown, context?: InvocationContext): HttpResponse => {
    const request = toHttpRequest(event, context);
    const correlationId = correlationIdFrom(request);
    logger.write('error', {
      event: 'bootstrap.error',
      correlationId,
      requestId: request.requestId,
      outcome: 'error',
      durationMs: 0,
      coldStart: true,
      reason: 'bootstrap_failed',
      errorCode: errorName(error),
    });
    // 503 e não 500: a causa mais comum é dependência (SSM, parâmetro ainda não
    // publicado pelo repositório de banco), não defeito desta função. E nunca
    // 200: sem dependências montadas, nenhum token pode ser emitido.
    return errorResponse(503, 'service_unavailable', SERVICE_UNAVAILABLE_MESSAGE, correlationId);
  };
}

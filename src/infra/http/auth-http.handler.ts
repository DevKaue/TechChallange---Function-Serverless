import type { AuthenticateCustomerUseCase } from '../../application/usecases/authenticate-customer.usecase';
import { CustomerNotAuthorizedError } from '../../domain/errors/customer-not-authorized.error';
import { DataSourceUnavailableError } from '../../domain/errors/data-source-unavailable.error';
import { InvalidCpfError } from '../../domain/errors/invalid-cpf.error';
import type { Logger } from '../logging/logger';
import { correlationIdFrom } from './correlation';
import {
  type AuthHttpEvent,
  type HttpRequest,
  type InvocationContext,
  toHttpRequest,
} from './http-event';
import {
  type HttpResponse,
  SERVICE_UNAVAILABLE_MESSAGE,
  errorResponse,
  jsonResponse,
} from './http-response';

function parseBody(event: HttpRequest): unknown {
  if (event.body === undefined) return {};

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  return JSON.parse(raw) as unknown;
}

/**
 * Cria o adapter HTTP com dependências explícitas.
 *
 * Aceita o evento v1.0 que o Kong envia e o v2.0 do HTTP API (ver
 * `http-event.ts`); a resposta `{statusCode, headers, body}` é a mesma nos dois.
 *
 * O handler NUNCA lança: exceção não tratada vira 502 no gateway, quebrando o
 * contrato 400/401/503. Por isso toda saída passa por `jsonResponse()` e o
 * try/catch cobre inclusive JSON malformado.
 */
export function createAuthHttpHandler(
  useCase: Pick<AuthenticateCustomerUseCase, 'execute'>,
  logger: Logger,
  now: () => number = Date.now,
) {
  let firstInvocation = true;

  return async (
    rawEvent: AuthHttpEvent,
    context?: InvocationContext,
  ): Promise<HttpResponse> => {
    const startedAt = now();
    const event = toHttpRequest(rawEvent, context);
    const requestId = event.requestId;
    const correlationId = correlationIdFrom(event);
    const coldStart = firstInvocation;
    firstInvocation = false;

    logger.write('info', {
      event: 'auth.attempt',
      correlationId,
      requestId,
      outcome: 'attempt',
      durationMs: 0,
      coldStart,
    });

    try {
      const body = parseBody(event);
      const cpf =
        typeof body === 'object' && body !== null
          ? (body as { cpf?: unknown }).cpf
          : undefined;
      const output = await useCase.execute({ cpf });

      logger.write('info', {
        event: 'auth.success',
        correlationId,
        requestId,
        outcome: 'success',
        durationMs: now() - startedAt,
        coldStart,
      });

      return jsonResponse(200, output, correlationId);
    } catch (error) {
      const durationMs = now() - startedAt;

      if (error instanceof SyntaxError || error instanceof InvalidCpfError) {
        logger.write('warn', {
          event: 'auth.invalid_cpf',
          correlationId,
          requestId,
          outcome: 'denied',
          durationMs,
          coldStart,
          reason: error instanceof SyntaxError ? 'malformed_json' : 'invalid_cpf',
        });
        return errorResponse(400, 'invalid_request', 'CPF inválido', correlationId);
      }

      if (error instanceof CustomerNotAuthorizedError) {
        logger.write('warn', {
          event: 'auth.denied',
          correlationId,
          requestId,
          outcome: 'denied',
          durationMs,
          coldStart,
          reason: error.reason,
        });
        return errorResponse(401, error.code, error.message, correlationId);
      }

      if (error instanceof DataSourceUnavailableError) {
        const causeCode =
          typeof error.cause === 'object' &&
          error.cause !== null &&
          'code' in error.cause &&
          typeof error.cause.code === 'string'
            ? error.cause.code
            : 'unknown';
        logger.write('error', {
          event: 'db.error',
          correlationId,
          requestId,
          outcome: 'error',
          durationMs,
          coldStart,
          reason: 'data_source_unavailable',
          errorCode: causeCode,
        });
        return errorResponse(503, error.code, SERVICE_UNAVAILABLE_MESSAGE, correlationId);
      }

      logger.write('error', {
        event: 'auth.error',
        correlationId,
        requestId,
        outcome: 'error',
        durationMs,
        coldStart,
        reason: 'unexpected',
      });
      return errorResponse(500, 'internal_error', 'Erro interno', correlationId);
    }
  };
}

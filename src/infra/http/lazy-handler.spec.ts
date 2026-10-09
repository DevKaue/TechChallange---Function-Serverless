import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { AuthLogEntry, Logger } from '../logging/logger';
import { authBootstrapFailure, createLazyHandler } from './lazy-handler';

class LoggerSpy implements Logger {
  entries: Array<{ level: 'info' | 'warn' | 'error'; entry: AuthLogEntry }> = [];

  write(level: 'info' | 'warn' | 'error', entry: AuthLogEntry): void {
    this.entries.push({ level, entry });
  }
}

describe('createLazyHandler', () => {
  it('monta as dependências uma vez e reaproveita no container aquecido', async () => {
    let bootstraps = 0;
    const handler = createLazyHandler(
      () => {
        bootstraps += 1;
        return Promise.resolve((n: number) => Promise.resolve(n * 2));
      },
      () => -1,
    );

    await expect(handler(1)).resolves.toBe(2);
    await expect(handler(2)).resolves.toBe(4);
    expect(bootstraps).toBe(1);
  });

  it('invocações concorrentes no cold start compartilham o mesmo bootstrap', async () => {
    let bootstraps = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = createLazyHandler(
      async () => {
        bootstraps += 1;
        await gate;
        return (n: number) => Promise.resolve(n);
      },
      () => -1,
    );

    const both = Promise.all([handler(1), handler(2)]);
    release();

    await expect(both).resolves.toEqual([1, 2]);
    expect(bootstraps).toBe(1);
  });

  it('falha no bootstrap vira a resposta de fallback, e a próxima invocação tenta de novo', async () => {
    let attempts = 0;
    const handler = createLazyHandler<number, number | string>(
      () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('SSM fora'))
          : Promise.resolve((n: number) => Promise.resolve(n));
      },
      (_event, error) => (error instanceof Error ? error.message : 'desconhecido'),
    );

    await expect(handler(7)).resolves.toBe('SSM fora');
    await expect(handler(7)).resolves.toBe(7);
    expect(attempts).toBe(2);
  });

  it('throw síncrono do bootstrap também cai no fallback, nunca escapa como exceção', async () => {
    const handler = createLazyHandler<number, string>(
      () => {
        throw new Error('Variável obrigatória ausente: APP_ENV');
      },
      () => 'fallback',
    );

    await expect(handler(1)).resolves.toBe('fallback');
  });

  it('erro DENTRO do handler montado não é confundido com falha de bootstrap', async () => {
    let bootstraps = 0;
    const handler = createLazyHandler<number, number>(
      () => {
        bootstraps += 1;
        return Promise.resolve(() => Promise.reject(new Error('regra')));
      },
      () => -1,
    );

    await expect(handler(1)).rejects.toThrow('regra');
    await expect(handler(1)).rejects.toThrow('regra');
    expect(bootstraps).toBe(1);
  });
});

function httpEvent(headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    headers,
    requestContext: { requestId: 'req-1' },
  } as unknown as APIGatewayProxyEventV2;
}

describe('authBootstrapFailure', () => {
  it('devolve 503 no contrato, com correlationId, e loga só o nome do erro', () => {
    const logger = new LoggerSpy();
    const failure = Object.assign(
      new Error('Parameter /techchallenge/staging/db/password not found'),
      { name: 'ParameterNotFound' },
    );

    const result = authBootstrapFailure(logger)(
      httpEvent({ 'x-correlation-id': 'boot-1' }),
      failure,
    );

    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body ?? '{}')).toEqual({
      error: 'service_unavailable',
      message: 'Serviço temporariamente indisponível',
      correlationId: 'boot-1',
    });
    expect(logger.entries).toEqual([
      {
        level: 'error',
        entry: expect.objectContaining({
          event: 'bootstrap.error',
          correlationId: 'boot-1',
          errorCode: 'ParameterNotFound',
        }) as unknown,
      },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain('/techchallenge/');
  });

  it('valor lançado que não é Error vira errorCode "unknown"', () => {
    const logger = new LoggerSpy();
    authBootstrapFailure(logger)(httpEvent(), 'string lançada');
    expect(logger.entries[0]?.entry.errorCode).toBe('unknown');
  });
});

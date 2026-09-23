import { ConsoleJsonLogger } from './logger';

describe('ConsoleJsonLogger', () => {
  it('emite uma linha JSON estruturada com contexto de runtime', () => {
    const write = jest.spyOn(console, 'log').mockImplementation();
    process.env.AWS_LAMBDA_FUNCTION_VERSION = '7';
    process.env.APP_ENV = 'homolog';
    const logger = new ConsoleJsonLogger();

    logger.write('warn', {
      event: 'auth.denied',
      correlationId: 'correlation-1',
      requestId: 'request-1',
      outcome: 'denied',
      durationMs: 12,
      coldStart: false,
      reason: 'not_found',
    });

    expect(write).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({
      level: 'warn',
      message: 'auth.denied',
      event: 'auth.denied',
      correlationId: 'correlation-1',
      functionVersion: '7',
      env: 'homolog',
    });
    expect(line.timestamp).toEqual(expect.any(String));

    write.mockRestore();
    delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
    delete process.env.APP_ENV;
  });
});

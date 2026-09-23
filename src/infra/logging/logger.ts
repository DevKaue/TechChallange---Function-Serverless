export type AuthLogEvent =
  | 'auth.attempt'
  | 'auth.success'
  | 'auth.denied'
  | 'auth.invalid_cpf'
  | 'db.error'
  | 'auth.error';

export interface AuthLogEntry {
  event: AuthLogEvent;
  correlationId: string;
  requestId: string;
  outcome: 'attempt' | 'success' | 'denied' | 'error';
  durationMs: number;
  coldStart: boolean;
  /** Motivo operacional. Nunca recebe CPF, nem claro, mascarado ou hash. */
  reason?: string;
  customerId?: string;
  errorCode?: string;
}

export interface Logger {
  write(level: 'info' | 'warn' | 'error', entry: AuthLogEntry): void;
}

/**
 * Logger JSON, sem dependência. O CloudWatch recebe uma linha por evento e o
 * Datadog/New Relic consome pelo subscription filter da infraestrutura.
 */
export class ConsoleJsonLogger implements Logger {
  write(level: 'info' | 'warn' | 'error', entry: AuthLogEntry): void {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message: entry.event,
      ...entry,
      functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION ?? 'local',
      env: process.env.APP_ENV ?? 'local',
    });

    // Uma única API de console mantém o formato idêntico entre níveis. O
    // campo `level` é o que o forwarder indexa; espalhar por console.warn/error
    // cria streams diferentes localmente sem ganho no CloudWatch.
    console.log(line);
  }
}

/**
 * A base de clientes não respondeu: conexão recusada, timeout de query, ou a
 * tabela `customers` ainda não existe.
 *
 * O último caso é real e não é hipotético: o RDS novo nasce VAZIO, e a tabela só
 * passa a existir depois do `prisma migrate deploy` da aplicação principal.
 * Enquanto isso, o Postgres devolve `relation "customers" does not exist` — que
 * precisa virar 503, e não 500, porque é indisponibilidade de dependência e não
 * defeito desta função.
 *
 * Nunca 200: a ausência de resposta do banco jamais pode virar token emitido.
 */
export class DataSourceUnavailableError extends Error {
  readonly code = 'service_unavailable';

  // `override` porque `cause` existe em Error desde ES2022 — sem o modificador
  // o tsc reprova com TS4115, e silenciar seria esconder que estamos mesmo
  // sobrescrevendo o campo padrão.
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'DataSourceUnavailableError';
  }
}

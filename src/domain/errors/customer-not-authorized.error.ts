/**
 * Cliente não autorizado a obter token.
 *
 * Cobre DOIS casos que, do lado de fora, são INDISTINGUÍVEIS de propósito:
 * CPF não cadastrado e cliente não elegível (arquivado, inativo ou bloqueado).
 *
 * Diferenciar os dois — 404 para inexistente, 403 para inativo — entregaria
 * enumeração de CPF de graça: com uma lista vazada, um atacante aprenderia quem
 * é cliente da oficina a custo zero. Isso é dado pessoal mais gancho de
 * engenharia social.
 *
 * O motivo real vai em `reason`, que é gravado APENAS no log estruturado e
 * nunca no corpo da resposta. O suporte chega a ele pelo correlationId em um
 * passo, sem que o atacante chegue a nada.
 *
 * Não há timing oracle: a consulta ao banco roda nos dois casos, então a
 * latência já é constante.
 */
export type NotAuthorizedReason = 'not_found' | 'archived' | 'inactive' | 'blocked';

export class CustomerNotAuthorizedError extends Error {
  readonly code = 'unauthorized';

  constructor(readonly reason: NotAuthorizedReason) {
    super('CPF não autorizado');
    this.name = 'CustomerNotAuthorizedError';
  }
}

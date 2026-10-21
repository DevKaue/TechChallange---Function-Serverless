/**
 * Ciclo de vida do cliente.
 *
 * Coluna NOVA, proposta pela Fase 3: o desafio exige consultar "a existência E o
 * status do cliente", e a tabela `customers` das Fases 1 e 2 só tinha
 * `deleted_at` (soft delete). A migration é do repositório da aplicação
 * principal; o ER e a justificativa formal ficam no repositório de banco.
 *
 * Enquanto a migration não for aplicada, apenas ACTIVE e o soft delete são
 * observáveis — os testes dos outros dois estados existem e ficam marcados.
 */
export enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  BLOCKED = 'BLOCKED',
}

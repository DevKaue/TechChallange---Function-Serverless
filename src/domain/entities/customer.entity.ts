import { CustomerStatus } from '../enums/customer-status.enum';
import {
  CustomerNotAuthorizedError,
  type NotAuthorizedReason,
} from '../errors/customer-not-authorized.error';

/**
 * Projeção mínima do cliente para autenticação.
 *
 * São quatro campos, e a ausência dos outros é deliberada: `name`, `email` e
 * `phone` não entram na projeção da consulta nem no token. Menos dado pessoal
 * saindo do banco é menos dado pessoal para vazar em log, em trace ou no próprio
 * JWT — que é base64, não cifrado.
 */
export class Customer {
  constructor(
    readonly id: string,
    readonly status: CustomerStatus,
    readonly deletedAt: Date | null,
  ) {}

  /**
   * Elegível = não arquivado E com status ACTIVE.
   *
   * O soft delete vem das Fases 1 e 2; o status é o ajuste de modelo da Fase 3.
   * Os dois convivem: arquivar continua sendo exclusão lógica, e o status
   * descreve o ciclo de vida de quem não foi arquivado.
   */
  isEligible(): boolean {
    return this.deletedAt === null && this.status === CustomerStatus.ACTIVE;
  }

  /**
   * Motivo da inelegibilidade, para o LOG — nunca para a resposta.
   *
   * Ver `CustomerNotAuthorizedError`: o corpo devolvido é idêntico em todos os
   * casos, e é o correlationId que liga a resposta ao motivo real.
   */
  notAuthorizedReason(): NotAuthorizedReason {
    if (this.deletedAt !== null) return 'archived';
    if (this.status === CustomerStatus.INACTIVE) return 'inactive';
    if (this.status === CustomerStatus.BLOCKED) return 'blocked';

    // Chamar isto num cliente elegível é erro de programação, não estado
    // possível: falhar alto é melhor que devolver um motivo inventado que
    // depois aparece no log como se fosse verdade.
    throw new CustomerNotAuthorizedError('not_found');
  }
}

import type { Customer } from '../entities/customer.entity';
import type { Cpf } from '../value-objects/cpf.vo';

export interface CustomerRepository {
  /**
   * Resolve o cliente por CPF. `null` quando não existe.
   *
   * A busca é sempre por `(document, document_type = 'CPF')`, que é o unique
   * composto da tabela. Isso tem duas consequências que valem teste: o mesmo
   * número cadastrado com `document_type` diferente é tratado como inexistente,
   * e o mesmo número pode coexistir como CPF e como RNE sem violar o unique.
   *
   * @throws {DataSourceUnavailableError} banco fora, timeout ou tabela ausente.
   */
  findByCpf(cpf: Cpf): Promise<Customer | null>;
}

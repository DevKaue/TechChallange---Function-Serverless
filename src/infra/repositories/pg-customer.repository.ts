import type { CustomerRepository } from '../../domain/contracts/customer-repository.interface';
import { Customer } from '../../domain/entities/customer.entity';
import { CustomerStatus } from '../../domain/enums/customer-status.enum';
import { DataSourceUnavailableError } from '../../domain/errors/data-source-unavailable.error';
import type { Cpf } from '../../domain/value-objects/cpf.vo';

interface CustomerRow {
  id: string;
  status: string;
  deleted_at: Date | null;
}

/**
 * A menor superfície do `pg` que o repositório precisa.
 *
 * `Pool`, `PoolClient` e um fake de teste satisfazem o contrato. Isso mantém o
 * adapter testável sem mockar módulo global e deixa a decisão Client vs Pool no
 * composition root, onde pertencem ciclo de vida e reuso de conexão.
 */
export interface SqlClient {
  query<T>(text: string, values: readonly unknown[]): Promise<{ rows: T[] }>;
}

export class PgCustomerRepository implements CustomerRepository {
  constructor(private readonly client: SqlClient) {}

  async findByCpf(cpf: Cpf): Promise<Customer | null> {
    try {
      const result = await this.client.query<CustomerRow>(
        `SELECT id, status, deleted_at
           FROM customers
          WHERE document = $1
            AND document_type = 'CPF'
          LIMIT 1`,
        [cpf.value],
      );

      const row = result.rows[0];
      if (row === undefined) return null;

      if (!Object.values(CustomerStatus).includes(row.status as CustomerStatus)) {
        // Status desconhecido significa drift entre banco e contrato da função.
        // Emitir token seria fail-open; tratar como dependência indisponível
        // preserva segurança e produz um 503 investigável pelo correlationId.
        throw new Error(`Status de cliente desconhecido: ${row.status}`);
      }

      return new Customer(row.id, row.status as CustomerStatus, row.deleted_at);
    } catch (error) {
      if (error instanceof DataSourceUnavailableError) throw error;

      // Não vaza SQL, host ou credencial para as camadas externas. O `cause`
      // segue disponível ao logger estruturado, que decide o que é seguro
      // registrar. Inclui `relation customers does not exist` e
      // `column status does not exist`: o RDS nasce vazio e a migration é de
      // outro repositório, logo ambos são indisponibilidade esperada da dependência.
      throw new DataSourceUnavailableError(
        'Base de clientes temporariamente indisponível.',
        error,
      );
    }
  }
}

import { CustomerStatus } from '../../domain/enums/customer-status.enum';
import { DataSourceUnavailableError } from '../../domain/errors/data-source-unavailable.error';
import { Cpf } from '../../domain/value-objects/cpf.vo';
import { PgCustomerRepository, type SqlClient } from './pg-customer.repository';

class SqlClientStub implements SqlClient {
  calls: Array<{ text: string; values: readonly unknown[] }> = [];
  rows: Array<{ id: string; status: string; deleted_at: Date | null }> = [];
  failure: Error | undefined;

  query<T>(text: string, values: readonly unknown[]): Promise<{ rows: T[] }> {
    this.calls.push({ text, values });
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return Promise.resolve({ rows: this.rows as T[] });
  }
}

describe('PgCustomerRepository', () => {
  let client: SqlClientStub;
  let repository: PgCustomerRepository;

  beforeEach(() => {
    client = new SqlClientStub();
    repository = new PgCustomerRepository(client);
  });

  it('consulta pelo documento normalizado e pelo tipo CPF numa query parametrizada', async () => {
    await repository.findByCpf(Cpf.create('111.444.777-35'));

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual(['11144477735']);
    expect(client.calls[0]?.text).toContain('document = $1');
    expect(client.calls[0]?.text).toContain("document_type = 'CPF'");
    expect(client.calls[0]?.text).toContain('LIMIT 1');
    expect(client.calls[0]?.text).not.toContain('11144477735');
  });

  it('projeta somente id, status e deleted_at, sem dado pessoal desnecessário', async () => {
    await repository.findByCpf(Cpf.create('11144477735'));

    const sql = client.calls[0]?.text ?? '';
    expect(sql).toContain('SELECT id, status, deleted_at');
    expect(sql).not.toMatch(/\bname\b/);
    expect(sql).not.toMatch(/\bemail\b/);
    expect(sql).not.toMatch(/\bphone\b/);
  });

  it('devolve null quando o CPF não existe', async () => {
    await expect(repository.findByCpf(Cpf.create('55566677720'))).resolves.toBeNull();
  });

  it.each(Object.values(CustomerStatus))('mapeia o status %s', async (status) => {
    client.rows = [
      {
        id: '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30',
        status,
        deleted_at: null,
      },
    ];

    await expect(repository.findByCpf(Cpf.create('11144477735'))).resolves.toMatchObject({
      status,
      deletedAt: null,
    });
  });

  it('preserva o soft delete retornado pelo banco', async () => {
    const deletedAt = new Date('2026-09-23T12:00:00.000Z');
    client.rows = [
      {
        id: '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30',
        status: CustomerStatus.ACTIVE,
        deleted_at: deletedAt,
      },
    ];

    await expect(repository.findByCpf(Cpf.create('22233344405'))).resolves.toMatchObject({
      deletedAt,
    });
  });

  it('drift de status falha fechado como 503, em vez de emitir token', async () => {
    client.rows = [
      {
        id: '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30',
        status: 'PENDING',
        deleted_at: null,
      },
    ];

    await expect(repository.findByCpf(Cpf.create('11144477735'))).rejects.toMatchObject({
      name: 'DataSourceUnavailableError',
      code: 'service_unavailable',
      message: 'Base de clientes temporariamente indisponível.',
    });
  });

  it.each([
    ['banco fora', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
    ['statement timeout', Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })],
    ['tabela ausente', Object.assign(new Error('relation "customers" does not exist'), { code: '42P01' })],
    ['coluna status ausente', Object.assign(new Error('column "status" does not exist'), { code: '42703' })],
  ])('%s vira DataSourceUnavailableError', async (_scenario, failure) => {
    client.failure = failure;

    let captured: unknown;
    try {
      await repository.findByCpf(Cpf.create('11144477735'));
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(DataSourceUnavailableError);
    expect(captured).toMatchObject({
      code: 'service_unavailable',
      cause: failure,
    });
  });
});

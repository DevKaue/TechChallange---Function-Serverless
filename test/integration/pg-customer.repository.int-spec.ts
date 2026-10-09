import { Client, Pool } from 'pg';
import { CustomerStatus } from '../../src/domain/enums/customer-status.enum';
import { DataSourceUnavailableError } from '../../src/domain/errors/data-source-unavailable.error';
import { Cpf } from '../../src/domain/value-objects/cpf.vo';
import { PgCustomerRepository } from '../../src/infra/repositories/pg-customer.repository';
import {
  CPF_NUNCA_CADASTRADO,
  CUSTOMERS_DDL,
  CUSTOMERS_DDL_SEM_STATUS,
  DATABASE_URL,
  SEED,
  asSqlClient,
  createIsolatedSchema,
  seed,
  type IsolatedSchema,
} from './support/database';

/**
 * O spec unitário do repositório prova o SQL como TEXTO. Este prova o SQL
 * contra um Postgres 15 de verdade — o unique composto, o tipo do documento, o
 * soft delete e os códigos de erro que o driver realmente devolve.
 */
describe('PgCustomerRepository contra Postgres real', () => {
  describe('com a tabela da Fase 3 (coluna status presente)', () => {
    let db: IsolatedSchema;
    let repository: PgCustomerRepository;

    beforeAll(async () => {
      db = await createIsolatedSchema(CUSTOMERS_DDL);
      await seed(db.client, Object.values(SEED));
      repository = new PgCustomerRepository(asSqlClient(db.client));
    });

    afterAll(async () => {
      await db.dispose();
    });

    it('encontra o cliente ativo pelo CPF normalizado a partir da máscara', async () => {
      const customer = await repository.findByCpf(Cpf.create('111.444.777-35'));

      expect(customer).toMatchObject({
        id: SEED.ativo.id,
        status: CustomerStatus.ACTIVE,
        deletedAt: null,
      });
      expect(customer?.isEligible()).toBe(true);
    });

    it('devolve null para CPF válido nunca cadastrado', async () => {
      await expect(repository.findByCpf(Cpf.create(CPF_NUNCA_CADASTRADO))).resolves.toBeNull();
    });

    it('trata como inexistente o número cadastrado só com outro tipo de documento', async () => {
      await expect(
        repository.findByCpf(Cpf.create(SEED.soComoRne.document)),
      ).resolves.toBeNull();
    });

    it('com o mesmo número como CPF e como RNE, devolve a linha do CPF', async () => {
      const customer = await repository.findByCpf(Cpf.create(SEED.duploCpf.document));

      expect(customer?.id).toBe(SEED.duploCpf.id);
      expect(customer?.status).toBe(CustomerStatus.ACTIVE);
    });

    it('o unique composto recusa o mesmo (documento, CPF) duas vezes', async () => {
      // Premissa do `LIMIT 1`: se o banco aceitasse duplicata, o LIMIT esconderia
      // qual das duas linhas decide a autenticação.
      await expect(
        seed(db.client, [{ ...SEED.ativo, id: '0b6f6c1e-8a53-4f7c-9a36-1f7a4a5d2e11' }]),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('preserva zeros à esquerda na ida ao banco', async () => {
      const customer = await repository.findByCpf(Cpf.create('000.000.001-91'));
      expect(customer?.id).toBe(SEED.zerosAEsquerda.id);
    });

    it('devolve o soft delete como Date e torna o cliente inelegível', async () => {
      const customer = await repository.findByCpf(Cpf.create(SEED.arquivado.document));

      expect(customer?.deletedAt).toBeInstanceOf(Date);
      expect(customer?.deletedAt?.toISOString()).toBe('2026-09-01T12:00:00.000Z');
      expect(customer?.notAuthorizedReason()).toBe('archived');
    });

    it.each([
      [SEED.inativo.document, CustomerStatus.INACTIVE, 'inactive'],
      [SEED.bloqueado.document, CustomerStatus.BLOCKED, 'blocked'],
    ])('%s volta com status %s e motivo %s', async (document, status, reason) => {
      const customer = await repository.findByCpf(Cpf.create(document));

      expect(customer?.status).toBe(status);
      expect(customer?.notAuthorizedReason()).toBe(reason);
    });
  });

  describe('drift entre banco e contrato', () => {
    let db: IsolatedSchema;

    afterEach(async () => {
      await db.dispose();
    });

    it('status desconhecido no banco falha fechado, nunca vira cliente elegível', async () => {
      db = await createIsolatedSchema(CUSTOMERS_DDL);
      await seed(db.client, [{ ...SEED.ativo, status: 'PENDING' }]);
      const repository = new PgCustomerRepository(asSqlClient(db.client));

      await expect(repository.findByCpf(Cpf.create(SEED.ativo.document))).rejects.toBeInstanceOf(
        DataSourceUnavailableError,
      );
    });

    it('RDS recém-criado, antes da migration: tabela ausente vira indisponibilidade (42P01)', async () => {
      db = await createIsolatedSchema();
      const repository = new PgCustomerRepository(asSqlClient(db.client));

      await expect(repository.findByCpf(Cpf.create(SEED.ativo.document))).rejects.toMatchObject({
        name: 'DataSourceUnavailableError',
        cause: { code: '42P01' },
      });
    });

    it('tabela das Fases 1 e 2, sem a coluna status, vira indisponibilidade (42703)', async () => {
      db = await createIsolatedSchema(CUSTOMERS_DDL_SEM_STATUS);
      const repository = new PgCustomerRepository(asSqlClient(db.client));

      await expect(repository.findByCpf(Cpf.create(SEED.ativo.document))).rejects.toMatchObject({
        name: 'DataSourceUnavailableError',
        cause: { code: '42703' },
      });
    });
  });

  describe('falhas de infraestrutura', () => {
    it('statement timeout real, provocado por lock, vira indisponibilidade (57014)', async () => {
      const db = await createIsolatedSchema(CUSTOMERS_DDL);
      await seed(db.client, [SEED.ativo]);

      // Segunda conexão segura um ACCESS EXCLUSIVE: o SELECT da primeira fica
      // bloqueado e o statement_timeout dispara de forma determinística, sem
      // depender de a query ser "lenta o bastante".
      const locker = new Client({ connectionString: DATABASE_URL });
      await locker.connect();

      try {
        await locker.query(`SET search_path TO ${db.name}`);
        await locker.query('BEGIN');
        await locker.query('LOCK TABLE customers IN ACCESS EXCLUSIVE MODE');

        await db.client.query(`SET statement_timeout = '200ms'`);
        const repository = new PgCustomerRepository(asSqlClient(db.client));

        await expect(repository.findByCpf(Cpf.create(SEED.ativo.document))).rejects.toMatchObject({
          name: 'DataSourceUnavailableError',
          cause: { code: '57014' },
        });
      } finally {
        await locker.query('ROLLBACK');
        await locker.end();
        await db.client.query('RESET statement_timeout');
        await db.dispose();
      }
    });

    it('banco fora do ar vira indisponibilidade, sem vazar host na mensagem', async () => {
      // Porta 1 no loopback: conexão recusada imediata, sem esperar timeout de rede.
      const pool = new Pool({
        host: '127.0.0.1',
        port: 1,
        user: 'ninguem',
        database: 'nenhum',
        connectionTimeoutMillis: 1_000,
      });
      const repository = new PgCustomerRepository(asSqlClient(pool));

      try {
        let captured: unknown;
        try {
          await repository.findByCpf(Cpf.create(SEED.ativo.document));
        } catch (error) {
          captured = error;
        }

        expect(captured).toBeInstanceOf(DataSourceUnavailableError);
        expect((captured as Error).message).toBe('Base de clientes temporariamente indisponível.');
        expect((captured as Error).message).not.toContain('127.0.0.1');
        expect((captured as DataSourceUnavailableError).cause).toMatchObject({
          code: 'ECONNREFUSED',
        });
      } finally {
        await pool.end();
      }
    });
  });
});

import { randomUUID } from 'node:crypto';
import { Client, type QueryResult } from 'pg';
import type { SqlClient } from '../../../src/infra/repositories/pg-customer.repository';

/**
 * Infra compartilhada dos testes de integração.
 *
 * Cada arquivo de teste cria um SCHEMA próprio e aponta o `search_path` para
 * ele. O motivo é observável: com todos os arquivos no `public`, dois workers do
 * Jest criando e derrubando `customers` ao mesmo tempo produzem
 * `relation "customers" does not exist` intermitente — exatamente o erro que um
 * dos testes quer provocar de propósito, e aí não dá para distinguir falha real
 * de corrida entre testes.
 */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

/**
 * Espelho da tabela `customers` da aplicação principal DEPOIS da migration
 * `20261009230000_add_status_to_customers` (Prisma): `id` é text, e
 * `document_type` e `status` são enums do Postgres, não text. Só as colunas que
 * a função lê, mais `name` para provar que a projeção não o traz.
 *
 * ATENÇÃO: isto é fixture, não fonte de verdade. Mudou a migration no
 * repositório da aplicação, muda aqui no mesmo dia, senão o teste passa contra
 * uma tabela que não é a de produção.
 */
export const CUSTOMERS_DDL = `
  CREATE TYPE "DocumentType" AS ENUM ('CPF', 'CNPJ', 'PASSPORT', 'RNE');
  CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');
  CREATE TABLE customers (
    id            text             PRIMARY KEY,
    name          text             NOT NULL,
    document      text             NOT NULL,
    document_type "DocumentType"   NOT NULL,
    status        "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    deleted_at    timestamp(3)     NULL,
    CONSTRAINT customers_document_document_type_key UNIQUE (document, document_type)
  )
`;

/** Mesma tabela, ANTES da migration da Fase 3: sem a coluna `status`. */
export const CUSTOMERS_DDL_SEM_STATUS = `
  CREATE TABLE customers (
    id            uuid        PRIMARY KEY,
    name          text        NOT NULL,
    document      text        NOT NULL,
    document_type text        NOT NULL,
    deleted_at    timestamptz NULL,
    CONSTRAINT customers_document_document_type_key UNIQUE (document, document_type)
  )
`;

export interface SeedRow {
  id: string;
  document: string;
  documentType: 'CPF' | 'RNE';
  status: string;
  deletedAt: Date | null;
}

/**
 * Massa sintética: os MESMOS números documentados em `cpf.vo.spec.ts`, com o
 * papel que aquele arquivo já atribui a cada um. Reaproveitar a lista evita uma
 * segunda massa que diverge da primeira sem ninguém perceber.
 */
export const SEED = {
  ativo: { id: randomUUID(), document: '11144477735', documentType: 'CPF', status: 'ACTIVE', deletedAt: null },
  arquivado: { id: randomUUID(), document: '22233344405', documentType: 'CPF', status: 'ACTIVE', deletedAt: new Date('2026-09-01T12:00:00.000Z') },
  inativo: { id: randomUUID(), document: '33322211169', documentType: 'CPF', status: 'INACTIVE', deletedAt: null },
  bloqueado: { id: randomUUID(), document: '44455566619', documentType: 'CPF', status: 'BLOCKED', deletedAt: null },
  soComoRne: { id: randomUUID(), document: '77788899941', documentType: 'RNE', status: 'ACTIVE', deletedAt: null },
  duploCpf: { id: randomUUID(), document: '88899900078', documentType: 'CPF', status: 'ACTIVE', deletedAt: null },
  // Mesmo número, outro tipo de documento, estado oposto: se a query esquecer o
  // filtro de `document_type`, o `LIMIT 1` pode devolver esta linha e o teste
  // de "duplo" pega a diferença pelo status E pelo id.
  duploRne: { id: randomUUID(), document: '88899900078', documentType: 'RNE', status: 'BLOCKED', deletedAt: null },
  zerosAEsquerda: { id: randomUUID(), document: '00000000191', documentType: 'CPF', status: 'ACTIVE', deletedAt: null },
} satisfies Record<string, SeedRow>;

/** Válido pelo DV e nunca cadastrado — nem como CPF nem como outro tipo. */
export const CPF_NUNCA_CADASTRADO = '55566677720';

/**
 * Estrutura mínima que Client e Pool do `pg` satisfazem. Declarada como método
 * para o TypeScript aceitar as sobrecargas do `pg` sem cast.
 */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

/**
 * Adapta Client/Pool ao `SqlClient` do repositório SEM mudar comportamento.
 * Existe só para o compilador: `readonly unknown[]` do contrato não é atribuível
 * ao `any[]` mutável que o `pg` declara.
 */
export function asSqlClient(db: Queryable): SqlClient {
  return {
    async query<T>(text: string, values: readonly unknown[]): Promise<{ rows: T[] }> {
      const result = await db.query(text, [...values]);
      return { rows: result.rows as T[] };
    },
  };
}

export interface IsolatedSchema {
  name: string;
  client: Client;
  dispose(): Promise<void>;
}

/**
 * Abre uma conexão dedicada, cria um schema com nome aleatório e fixa o
 * `search_path` nele. Nada vaza para `public` nem para outro arquivo de teste.
 */
export async function createIsolatedSchema(ddl?: string): Promise<IsolatedSchema> {
  const name = `it_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  // Nome gerado aqui mesmo, só [a-z0-9_]: interpolar é seguro. Identificador
  // não aceita parâmetro `$1` no Postgres.
  await client.query(`CREATE SCHEMA ${name}`);
  await client.query(`SET search_path TO ${name}`);
  if (ddl !== undefined) await client.query(ddl);

  return {
    name,
    client,
    async dispose() {
      try {
        await client.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
      } finally {
        await client.end();
      }
    },
  };
}

export async function seed(client: Queryable, rows: readonly SeedRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO customers (id, name, document, document_type, status, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, 'Cliente Sintético', row.document, row.documentType, row.status, row.deletedAt],
    );
  }
}

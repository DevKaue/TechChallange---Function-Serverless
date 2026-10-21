import type { CustomerRepository } from '../../domain/contracts/customer-repository.interface';
import type { IdGenerator } from '../../domain/contracts/id-generator.interface';
import type {
  CustomerAccessTokenPayload,
  TokenService,
} from '../../domain/contracts/token-service.interface';
import { Customer } from '../../domain/entities/customer.entity';
import { CustomerStatus } from '../../domain/enums/customer-status.enum';
import { CustomerNotAuthorizedError } from '../../domain/errors/customer-not-authorized.error';
import { InvalidCpfError } from '../../domain/errors/invalid-cpf.error';
import type { Cpf } from '../../domain/value-objects/cpf.vo';
import {
  AuthenticateCustomerUseCase,
  CUSTOMER_TOKEN_ISSUER,
} from './authenticate-customer.usecase';

const CUSTOMER_ID = '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30';
const JTI = '87d0ec5b-c99a-4bf5-aeca-5d9fe87dff01';

class CustomerRepositoryStub implements CustomerRepository {
  calls: Cpf[] = [];
  result: Customer | null = new Customer(CUSTOMER_ID, CustomerStatus.ACTIVE, null);

  findByCpf(cpf: Cpf): Promise<Customer | null> {
    this.calls.push(cpf);
    return Promise.resolve(this.result);
  }
}

class TokenServiceSpy implements TokenService {
  calls: CustomerAccessTokenPayload[] = [];

  sign(payload: CustomerAccessTokenPayload) {
    this.calls.push(payload);
    return { accessToken: 'jwt-assinado', expiresIn: 3600 } as const;
  }
}

class IdGeneratorStub implements IdGenerator {
  calls = 0;

  generate(): string {
    this.calls += 1;
    return JTI;
  }
}

describe('AuthenticateCustomerUseCase', () => {
  let repository: CustomerRepositoryStub;
  let tokenService: TokenServiceSpy;
  let idGenerator: IdGeneratorStub;
  let useCase: AuthenticateCustomerUseCase;

  beforeEach(() => {
    repository = new CustomerRepositoryStub();
    tokenService = new TokenServiceSpy();
    idGenerator = new IdGeneratorStub();
    useCase = new AuthenticateCustomerUseCase(repository, tokenService, idGenerator);
  });

  it('autentica cliente ativo e devolve o contrato HTTP congelado', async () => {
    await expect(useCase.execute({ cpf: '111.444.777-35' })).resolves.toEqual({
      access_token: 'jwt-assinado',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  it('normaliza antes de entregar ao repositório, mas só depois de validar o formato', async () => {
    await useCase.execute({ cpf: '111.444.777-35' });

    expect(repository.calls).toHaveLength(1);
    expect(repository.calls[0]?.value).toBe('11144477735');
  });

  it('monta somente as claims mínimas do token de cliente', async () => {
    await useCase.execute({ cpf: '11144477735' });

    expect(tokenService.calls).toEqual([
      {
        sub: CUSTOMER_ID,
        type: 'customer',
        iss: CUSTOMER_TOKEN_ISSUER,
        jti: JTI,
      },
    ]);

    const payload = tokenService.calls[0] as unknown as Record<string, unknown>;
    expect(payload).not.toHaveProperty('cpf');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('name');
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('status');
  });

  it('gera um jti por autenticação bem-sucedida', async () => {
    await useCase.execute({ cpf: '11144477735' });
    expect(idGenerator.calls).toBe(1);
  });

  it('CPF inválido falha antes de tocar banco, token ou gerador de id', async () => {
    await expect(useCase.execute({ cpf: '11144477734' })).rejects.toBeInstanceOf(
      InvalidCpfError,
    );

    expect(repository.calls).toHaveLength(0);
    expect(tokenService.calls).toHaveLength(0);
    expect(idGenerator.calls).toBe(0);
  });

  it('cliente inexistente vira 401 genérico e não assina token', async () => {
    repository.result = null;

    await expect(useCase.execute({ cpf: '55566677720' })).rejects.toMatchObject({
      message: 'CPF não autorizado',
      code: 'unauthorized',
      reason: 'not_found',
    });

    expect(tokenService.calls).toHaveLength(0);
    expect(idGenerator.calls).toBe(0);
  });

  it.each([
    [new Customer(CUSTOMER_ID, CustomerStatus.ACTIVE, new Date()), 'archived'],
    [new Customer(CUSTOMER_ID, CustomerStatus.INACTIVE, null), 'inactive'],
    [new Customer(CUSTOMER_ID, CustomerStatus.BLOCKED, null), 'blocked'],
  ])('cliente inelegível vira a mesma mensagem externa, com reason %s só para log', async (
    customer,
    reason,
  ) => {
    repository.result = customer;

    let captured: unknown;
    try {
      await useCase.execute({ cpf: '11144477735' });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(CustomerNotAuthorizedError);
    expect(captured).toMatchObject({
      message: 'CPF não autorizado',
      code: 'unauthorized',
      reason,
    });
    expect(tokenService.calls).toHaveLength(0);
    expect(idGenerator.calls).toBe(0);
  });

  it('propaga indisponibilidade da fonte sem mascarar como não autorizado', async () => {
    const failure = new Error('connection timeout');
    repository.findByCpf = () => Promise.reject(failure);

    await expect(useCase.execute({ cpf: '11144477735' })).rejects.toBe(failure);
    expect(tokenService.calls).toHaveLength(0);
  });
});

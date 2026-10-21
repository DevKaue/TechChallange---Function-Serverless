import type { CustomerRepository } from '../../domain/contracts/customer-repository.interface';
import type { IdGenerator } from '../../domain/contracts/id-generator.interface';
import type { TokenService } from '../../domain/contracts/token-service.interface';
import { CustomerNotAuthorizedError } from '../../domain/errors/customer-not-authorized.error';
import { Cpf } from '../../domain/value-objects/cpf.vo';
import type {
  AuthenticateCustomerInput,
  AuthenticateCustomerOutput,
} from '../dtos/authenticate-customer.dto';

export const CUSTOMER_TOKEN_ISSUER = 'techchallenge-auth-lambda';

/**
 * Autentica o cliente sem conhecer HTTP, AWS, Postgres ou JWT.
 *
 * Essa independência é a fronteira da Clean Architecture neste repositório:
 * handler, driver `pg` e `jsonwebtoken` são detalhes substituíveis; a ordem das
 * regras abaixo não é.
 */
export class AuthenticateCustomerUseCase {
  constructor(
    private readonly customerRepository: CustomerRepository,
    private readonly tokenService: TokenService,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(input: AuthenticateCustomerInput): Promise<AuthenticateCustomerOutput> {
    // Precisa vir ANTES de qualquer I/O. Além de economizar consulta, este é o
    // que torna verificável o AC-A1: CPF inválido toca o banco zero vezes.
    const cpf = Cpf.create(input.cpf);

    const customer = await this.customerRepository.findByCpf(cpf);

    // Inexistente e inelegível devolvem a MESMA classe e a MESMA mensagem. O
    // `reason` é dado operacional destinado ao log estruturado, nunca ao corpo.
    if (customer === null) {
      throw new CustomerNotAuthorizedError('not_found');
    }

    if (!customer.isEligible()) {
      throw new CustomerNotAuthorizedError(customer.notAuthorizedReason());
    }

    const signed = this.tokenService.sign({
      sub: customer.id,
      type: 'customer',
      iss: CUSTOMER_TOKEN_ISSUER,
      jti: this.idGenerator.generate(),
    });

    return {
      access_token: signed.accessToken,
      token_type: 'Bearer',
      // O literal 3600 no DTO e no contrato impede a string `'1h'` de entrar e
      // remove ambiguidade na prova `exp - iat === 3600`.
      expires_in: signed.expiresIn,
    };
  }
}
